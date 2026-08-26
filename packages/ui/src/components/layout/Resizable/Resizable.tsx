import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import React, { useMemo } from 'react';

import { defaultHandles, handleStyle, resolveResizableProps } from './Resizable.helpers';
import { useResize } from './Resizable.hooks';
import type { ResizableProps } from './Resizable.types';

export const Resizable: React.FC<ResizableProps> = (rawProps) => {
  const {
    children,
    variant,
    width: initialWidth,
    height: initialHeight,
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
  const bounds = useMemo(
    () => ({
      width: { min: minWidth, max: maxWidth },
      height: { min: minHeight, max: maxHeight },
    }),
    [minWidth, maxWidth, minHeight, maxHeight],
  );

  const { size, isResizing, activeHandle, handleMouseDown } = useResize({
    width: initialWidth,
    height: initialHeight,
    bounds,
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
