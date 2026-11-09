import Box from '@mui/material/Box/index.js';
import React from 'react';

import { CarouselIndicators } from './Carousel.parts';
import type { CarouselIndicatorsProps } from './Carousel.types';

/**
 * With `indicatorPosition="below"` the frame and the dot row share a wrapper, so
 * the row sits outside the photo; otherwise the frame is returned as it is.
 */
export const CarouselBelow: React.FC<{
  show: boolean;
  width: string;
  indicators: Omit<CarouselIndicatorsProps, 'position'>;
  children: React.ReactNode;
}> = ({ show, width, indicators, children }) =>
  show ? (
    <Box sx={{ width }}>
      {children}
      <CarouselIndicators {...indicators} position="below" />
    </Box>
  ) : (
    <>{children}</>
  );
