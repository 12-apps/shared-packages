import PlayIcon from '@mui/icons-material/PlayArrow';
import { Box } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { thumbnailStripSx } from './Lightbox.constants';
import type { LightboxItem } from './Lightbox.types';

const THUMB_WIDTH = 60;
const THUMB_HEIGHT = 40;

const VideoThumbnail: FC = () => (
  <Box
    sx={{
      width: '100%',
      height: '100%',
      background: 'rgba(255, 255, 255, 0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <PlayIcon sx={{ color: 'white', fontSize: 16 }} />
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
      bottom: 16,
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
          width: THUMB_WIDTH,
          height: THUMB_HEIGHT,
          cursor: 'pointer',
          border: currentIndex === index ? '2px solid white' : '2px solid transparent',
          borderRadius: 0.5,
          overflow: 'hidden',
          flexShrink: 0,
          '&:hover': { border: '2px solid rgba(255, 255, 255, 0.7)' },
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
