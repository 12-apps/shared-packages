import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import type { FC, ReactNode, UIEvent } from 'react';
import React from 'react';

import { getOverflowStyle, getVariantStyles } from './ScrollArea.styles';
import type { ResolvedScrollAreaProps } from './ScrollArea.helpers';

export interface ScrollViewportProps
  extends Pick<
    ResolvedScrollAreaProps,
    | 'height'
    | 'maxHeight'
    | 'orientation'
    | 'scrollbarSize'
    | 'scrollbarColor'
    | 'scrollbarTrackColor'
    | 'contentPadding'
    | 'variant'
    | 'disabled'
    | 'loading'
    | 'smoothScroll'
  > {
  /** The scroll region's accessible name. REQUIRED. */
  regionLabel: string;
  children: ReactNode;
  shouldShowScrollbar: boolean;
  setScrollRef: (node: HTMLDivElement | null) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

// The element that actually scrolls: its own overflow and scrollbar styling,
// plus the disabled and loading treatments.
export const ScrollViewport: FC<ScrollViewportProps> = ({
  regionLabel,
  children,
  height,
  maxHeight,
  orientation,
  scrollbarSize,
  scrollbarColor,
  scrollbarTrackColor,
  contentPadding,
  variant,
  disabled,
  loading,
  smoothScroll,
  shouldShowScrollbar,
  setScrollRef,
  onScroll,
}) => {
  const theme = useTheme();

  return (
    <Box
      ref={setScrollRef}
      onScroll={onScroll}
      role="region"
      aria-label={regionLabel}
      aria-busy={loading}
      tabIndex={disabled ? -1 : 0}
      sx={{
        width: '100%',
        height: '100%',
        // Use an explicit maxHeight when height is 'auto', else inherit.
        maxHeight: height === 'auto' && maxHeight ? maxHeight : '100%',
        padding: contentPadding,
        opacity: loading ? 0.5 : 1,
        pointerEvents: disabled || loading ? 'none' : 'auto',
        transition: 'opacity 0.3s ease',
        '&:focus': {
          outline: 'none',
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: -2,
          },
        },
        ...getOverflowStyle({ disabled, orientation }),
        ...getVariantStyles({
          theme,
          variant,
          orientation,
          scrollbarSize,
          scrollbarColor,
          scrollbarTrackColor,
          shouldShowScrollbar,
        }),
      }}
      style={{ scrollBehavior: smoothScroll ? 'smooth' : 'auto' }}
    >
      {children}
    </Box>
  );
};
