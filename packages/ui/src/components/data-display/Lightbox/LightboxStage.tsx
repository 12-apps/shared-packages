import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type { FC, ReactNode } from 'react';
import React from 'react';

import { captionSx, counterSx } from './Lightbox.constants';
import type { LightboxItem } from './Lightbox.types';
import { onMedia } from '../../../tokens/ink';
import { rems, sxRem } from '../../../tokens/relative';

type TestId = (suffix: string) => string;

export interface LightboxStageProps {
  items: LightboxItem[];
  currentItem?: LightboxItem;
  currentIndex: number;
  isLoading: boolean;
  showCaptions: boolean;
  thumbnails: boolean;
  testId: TestId;
  media: ReactNode;
  thumbnailStrip: ReactNode;
}

const STAGE_SX = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  position: 'relative',
  height: '100vh',
  overflow: 'hidden',
} as const;

const MEDIA_BOX_SX = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
} as const;

// The viewport itself: the media, whatever floats over it, and the filmstrip.
export const LightboxStage: FC<LightboxStageProps> = ({
  items,
  currentItem,
  currentIndex,
  isLoading,
  showCaptions,
  thumbnails,
  testId,
  media,
  thumbnailStrip,
}) => (
  <DialogContent
    sx={STAGE_SX}
    data-testid={testId('content')}
  >
    {isLoading && (
      <CircularProgress
        sx={{ position: 'absolute', color: onMedia, zIndex: 999 }}
        data-testid={testId('loading')}
      />
    )}

    <Box
      sx={MEDIA_BOX_SX}
      data-testid={testId('image-container')}
    >
      {media}
    </Box>

    {showCaptions && currentItem?.caption && (
      <Typography
        id="lightbox-description"
        sx={{
          ...captionSx,
          position: 'absolute',
          // Sit above the filmstrip when there is one.
          bottom: sxRem(thumbnails ? 120 : 16),
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '80vw',
          padding: 2,
        }}
        data-testid={testId('caption')}
      >
        {currentItem.caption}
      </Typography>
    )}

    {items.length > 1 && (
      <Typography
        sx={{
          ...counterSx,
          position: 'absolute',
          top: sxRem(70),
          right: sxRem(16),
          padding: (theme: Theme) => rems(theme, 4, 8),
        }}
        aria-live="polite"
        data-testid={testId('counter')}
      >
        {currentIndex + 1} / {items.length}
      </Typography>
    )}

    {thumbnailStrip}
  </DialogContent>
);
