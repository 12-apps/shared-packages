import PlayIcon from '@mui/icons-material/PlayArrow';
import Box from '@mui/material/Box/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import { thumbnailStripSx } from './Lightbox.constants';
import type { LightboxItem } from './Lightbox.types';
import { onMedia, sheen } from '../../../tokens/ink';
import { rem, sxRem } from '../../../tokens/relative';

/** One filmstrip frame, in design px. */
const THUMB = { widthPx: 60, heightPx: 40 } as const;

const frame = (theme: Theme, color: string): string => `${rem(theme, 2)} solid ${color}`;

const VideoThumbnail: FC = () => (
  <Box
    sx={{
      width: '100%',
      height: '100%',
      background: (theme: Theme) => sheen(theme, 0.1),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <PlayIcon sx={{ color: onMedia, fontSize: sxRem(16) }} />
  </Box>
);

export interface LightboxThumbnailsProps {
  items: LightboxItem[];
  currentIndex: number;
  testId: (suffix: string) => string;
  onSelect: (index: number) => void;
}

export const LightboxThumbnails: FC<LightboxThumbnailsProps> = ({
  items,
  currentIndex,
  testId,
  onSelect,
}) => (
  <Box
    sx={{
      ...thumbnailStripSx,
      position: 'absolute',
      bottom: sxRem(16),
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: 1,
      maxWidth: '90vw',
      overflowX: 'auto',
      padding: 1,
    }}
    data-testid={testId('thumbnails')}
  >
    {items.map((item, index) => (
      <Box
        key={`${item.src}-${index}`}
        onClick={() => onSelect(index)}
        sx={{
          width: sxRem(THUMB.widthPx),
          height: sxRem(THUMB.heightPx),
          cursor: 'pointer',
          border: (theme: Theme) => frame(theme, currentIndex === index ? onMedia(theme) : 'transparent'),
          borderRadius: 0.5,
          overflow: 'hidden',
          flexShrink: 0,
          '&:hover': { border: (theme: Theme) => frame(theme, sheen(theme, 0.7)) },
        }}
        data-testid={testId(`thumbnail-${index}`)}
      >
        {item.type === 'video' ? (
          <VideoThumbnail />
        ) : (
          <img
            src={item.src}
            alt={item.alt || `Thumbnail ${index + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </Box>
    ))}
  </Box>
);
