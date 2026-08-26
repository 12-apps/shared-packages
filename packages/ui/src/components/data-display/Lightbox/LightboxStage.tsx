import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { FC, ReactNode } from 'react';
import React from 'react';

import { captionSx, counterSx } from './Lightbox.constants';
import type { LightboxItem } from './Lightbox.types';

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
    sx={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      position: 'relative',
      height: '100vh',
      overflow: 'hidden',
    }}
    data-testid={testId('content')}
  >
    {isLoading && (
      <CircularProgress
        sx={{ position: 'absolute', color: 'white', zIndex: 999 }}
        data-testid={testId('loading')}
      />
    )}

    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
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
          bottom: thumbnails ? 120 : 16,
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
        sx={{ ...counterSx, position: 'absolute', top: 70, right: 16, padding: '4px 8px' }}
        aria-live="polite"
        data-testid={testId('counter')}
      >
        {currentIndex + 1} / {items.length}
      </Typography>
    )}

    {thumbnailStrip}
  </DialogContent>
);
