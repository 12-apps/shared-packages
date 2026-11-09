import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { onMedia, scrim } from '../../../tokens/ink';

/**
 * The "n of m" chip over the photo. Its words come from the caller; it carries
 * no `aria-live` of its own because the slides are the live region.
 */
export const CarouselCounter: React.FC<{
  text: string;
  position?: 'top-end' | 'bottom-end';
}> = ({ text, position = 'top-end' }) => {
  const theme = useTheme();

  return (
    <Typography
      component="span"
      variant="caption"
      data-testid="carousel-counter"
      sx={{
        position: 'absolute',
        zIndex: 2,
        insetInlineEnd: theme.spacing(1.5),
        ...(position === 'top-end' ? { top: theme.spacing(1.5) } : { bottom: theme.spacing(1.5) }),
        px: 1,
        py: 0.25,
        borderRadius: theme.spacing(2),
        fontWeight: 600,
        color: onMedia(theme),
        backgroundColor: scrim(theme, 0.6),
        pointerEvents: 'none',
      }}
    >
      {text}
    </Typography>
  );
};
