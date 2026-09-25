import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React, { useMemo } from 'react';

import { remPx } from '../../../tokens/relative';

import {
  axisPx,
  defaultHandles,
  handleStyle,
  resolveResizableProps,
  startSizePx,
} from './Resizable.helpers';
import { useResize } from './Resizable.hooks';
import type { ResizableProps } from './Resizable.types';

export const Resizable: React.FC<ResizableProps> = (rawProps) => {
  const {
    children,
    variant,
    width,
    height,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    onResize,
    disabled,
    handles,
    className,
    'data-testid': dataTestId,
    ...rest
  } = resolveResizableProps(rawProps);
  const theme = useTheme();
  // Keyed apart: a new `start` re-seats the box, which a changed clamp must not do.
  const start = useMemo(() => startSizePx(theme, width, height), [theme, width, height]);
  const bounds = useMemo(
    () => ({
      width: axisPx(theme, minWidth, maxWidth),
      height: axisPx(theme, minHeight, maxHeight),
    }),
    [theme, minWidth, maxWidth, minHeight, maxHeight],
  );

  const { size, isResizing, activeHandle, handleMouseDown } = useResize({
    start,
    bounds,
    pxPerDesignPx: remPx(theme, 1),
    disabled,
    onResize,
  });

  const activeHandles = handles || defaultHandles(variant);

  return (
    <Box
      {...rest}
      className={className}
      data-testid={dataTestId}
      sx={{
        position: 'relative',
        // The live size: the start and the clamp came through `remPx`, the rest
        // is pointer pixels dragged, so it is px as it stands.
        width: size.width,
        height: size.height,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: theme.spacing(0.5),
        overflow: 'hidden',
        userSelect: isResizing ? 'none' : 'auto',
        '&:hover .resize-handle': {
          opacity: 0.3,
        },
      }}
    >
      {children}
      {!disabled &&
        activeHandles.map((handle) => (
          <Box
            key={handle}
            className="resize-handle"
            data-testid={dataTestId ? `${dataTestId}-handle-${handle}` : undefined}
            sx={handleStyle(theme, handle, isResizing && activeHandle.current === handle)}
            onMouseDown={(e) => handleMouseDown(e, handle)}
          />
        ))}
    </Box>
  );
};
