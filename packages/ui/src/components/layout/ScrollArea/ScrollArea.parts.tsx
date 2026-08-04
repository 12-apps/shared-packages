import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import { alpha, Box, CircularProgress, Fab, useTheme, Zoom } from '@mui/material';
import React from 'react';

// Children that drive their own scrolling (VirtualList, VirtualGrid) take this
// container's ref instead, so the two do not fight over one scrollbar.
const enhanceChildren = (
  children: React.ReactNode,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  containerWidth: number,
) =>
  React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;

    // Check if the child component accepts scrollContainerRef prop
    // by looking at its props type or if it's a known virtualization component
    const childProps = child.props as Record<string, unknown>;
    if (!('disableInternalScroll' in childProps) && childProps.scrollContainerRef === undefined) {
      return child;
    }

    const enhancedProps: Record<string, unknown> = {
      scrollContainerRef: scrollRef,
      disableInternalScroll: true,
    };
    // If child accepts width and doesn't have one set, provide container width
    if (containerWidth > 0 && childProps.width === '100%') {
      enhancedProps.width = containerWidth;
    }

    return React.cloneElement(child, enhancedProps);
  });

// Render empty content if no children and emptyContent is provided
export const ScrollAreaContent: React.FC<{
  children: React.ReactNode;
  emptyContent?: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  containerWidth: number;
}> = ({ children, emptyContent, scrollRef, containerWidth }) => {
  const theme = useTheme();

  if (!children && emptyContent) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 200,
          color: theme.palette.text.secondary,
        }}
      >
        {emptyContent}
      </Box>
    );
  }

  return <>{enhanceChildren(children, scrollRef, containerWidth)}</>;
};

export const LoadingOverlay: React.FC<{ loading: boolean }> = ({ loading }) =>
  loading ? (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
      }}
    >
      <CircularProgress />
    </Box>
  ) : null;

export const ScrollToTopButton: React.FC<{
  visible: boolean;
  shown: boolean;
  glass: boolean;
  onClick: () => void;
}> = ({ visible, shown, glass, onClick }) => {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <Zoom in={shown}>
      <Fab
        size="small"
        aria-label="Scroll to top"
        onClick={onClick}
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 1,
          backgroundColor: glass
            ? alpha(theme.palette.primary.main, 0.2)
            : theme.palette.primary.main,
          backdropFilter: glass ? 'blur(10px)' : 'none',
          '&:hover': {
            backgroundColor: glass
              ? alpha(theme.palette.primary.main, 0.3)
              : theme.palette.primary.dark,
          },
        }}
      >
        <KeyboardArrowUp />
      </Fab>
    </Zoom>
  );
};
