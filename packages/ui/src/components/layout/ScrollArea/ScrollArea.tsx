import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import { alpha, Box, CircularProgress,Fab, useTheme, Zoom } from '@mui/material';
import React, { useCallback,useEffect, useRef, useState } from 'react';

import {
  getOverflowStyle,
  getVariantStyles,
} from './ScrollArea.styles';
import type { ScrollAreaProps } from './ScrollArea.types';

// Owns the scroll container ref (merging in any ref the caller passed) and
// reports size changes through a ResizeObserver.
const useObservedScrollRef = ({
  externalScrollRef,
  onResize,
}: {
  externalScrollRef?: React.Ref<HTMLDivElement>;
  onResize?: ScrollAreaProps['onResize'];
}) => {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  // Track container dimensions with ResizeObserver
  useEffect(() => {
    if (!internalScrollRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerDimensions({ width, height });
        onResize?.({ width, height });
      }
    });

    resizeObserver.observe(internalScrollRef.current);
    return () => resizeObserver.disconnect();
  }, [onResize]);

  // Callback ref that updates both internal and external refs
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Update internal ref
      (internalScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      // Update external ref if provided
      if (externalScrollRef) {
        (externalScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [externalScrollRef],
  );

  // Use internal ref for accessing the element

  return { scrollRef: internalScrollRef, setScrollRef, containerDimensions };
};

// Scroll position, the transient "is scrolling" flag that drives auto-hide, the
// observed container size, and the scroll-to-top affordance.
const useScrollArea = ({
  disabled,
  onScroll,
  onResize,
  externalScrollRef,
  autoHide,
  autoHideDelay,
  alwaysShowScrollbar,
  scrollToTopButton,
  scrollToTopThreshold = 200,
  smoothScroll,
}: {
  disabled?: boolean;
  onScroll?: ScrollAreaProps['onScroll'];
  onResize?: ScrollAreaProps['onResize'];
  externalScrollRef?: React.Ref<HTMLDivElement>;
  autoHide?: boolean;
  autoHideDelay?: number;
  alwaysShowScrollbar?: boolean;
  scrollToTopButton?: boolean;
  scrollToTopThreshold?: number;
  smoothScroll?: boolean;
}) => {
  const { scrollRef, setScrollRef, containerDimensions } = useObservedScrollRef({
    externalScrollRef,
    onResize,
  });
  const [showScrollToTop, setShowScrollToTop] = useState(false);

const [isScrolling, setIsScrolling] = useState(false);
const scrollTimeoutRef = useRef<number | undefined>(undefined);

// Get scrollbar size in pixels
// Get scrollbar colors
// Get overflow style based on orientation
// Handle scroll event
const handleScroll = useCallback(
  (event: React.UIEvent<HTMLDivElement>) => {
    if (disabled) return;

    // Handle auto-hide behavior
    if (autoHide && !alwaysShowScrollbar) {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        setIsScrolling(false);
      }, autoHideDelay);
    }

    // Check if should show scroll to top button
    if (scrollToTopButton && scrollRef.current) {
      const scrollTop = scrollRef.current.scrollTop;
      setShowScrollToTop(scrollTop > scrollToTopThreshold);
    }

    // Call user's onScroll handler
    if (onScroll) {
      onScroll(event);
    }
  },
  [
    disabled,
    autoHide,
    alwaysShowScrollbar,
    autoHideDelay,
    scrollToTopButton,
    scrollToTopThreshold,
    onScroll,
  ],
);

// Scroll to top function
const scrollToTop = useCallback(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTo({
      top: 0,
      behavior: smoothScroll ? 'smooth' : 'auto',
    });
  }
}, [smoothScroll]);

// Clean up timeout on unmount
useEffect(() => () => {
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
  }, []);

// Determine if scrollbar should be visible

  return {
    scrollRef,
    setScrollRef,
    isScrolling,
    showScrollToTop,
    containerDimensions,
    handleScroll,
    scrollToTop,
  };
};

export const ScrollArea: React.FC<ScrollAreaProps> = ({
  children,
  width = '100%',
  height = '100%',
  maxHeight,
  maxWidth,
  orientation = 'vertical',
  scrollbarSize = 'medium',
  autoHide = true,
  autoHideDelay = 1000,
  smoothScroll = true,
  variant = 'default',
  onScroll,
  scrollToTopButton = false,
  scrollToTopThreshold = 100,
  scrollbarColor,
  scrollbarTrackColor,
  contentPadding = 0,
  alwaysShowScrollbar = false,
  disabled = false,
  loading = false,
  emptyContent,
  testId = 'scroll-area',
  scrollRef: externalScrollRef,
  onResize,
  sx,
  ...props
}) => {
  const theme = useTheme();
  const {
    scrollRef,
    setScrollRef,
    isScrolling,
    showScrollToTop,
    containerDimensions,
    handleScroll,
    scrollToTop,
  } = useScrollArea({
    disabled,
    onScroll,
    onResize,
    externalScrollRef,
    autoHide,
    autoHideDelay,
    alwaysShowScrollbar,
    scrollToTopButton,
    scrollToTopThreshold,
    smoothScroll,
  });

  const shouldShowScrollbar = alwaysShowScrollbar || !autoHide || isScrolling;

  // Get variant-specific styles
  // Render empty content if no children and emptyContent is provided
  const renderContent = () => {
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

    // Auto-enhance children that accept scrollContainerRef (like VirtualList/VirtualGrid)
    return React.Children.map(children, (child) => {
      if (React.isValidElement(child)) {
        // Check if the child component accepts scrollContainerRef prop
        // by looking at its props type or if it's a known virtualization component
        const childProps = child.props as Record<string, unknown>;

        // If child has disableInternalScroll prop, it's likely a VirtualList/VirtualGrid
        // Auto-inject scrollContainerRef, disableInternalScroll, and container width
        if ('disableInternalScroll' in childProps || childProps.scrollContainerRef !== undefined) {
          const enhancedProps: Record<string, unknown> = {
            scrollContainerRef: scrollRef,
            disableInternalScroll: true,
          };

          // If child accepts width and doesn't have one set, provide container width
          if (containerDimensions.width > 0 && childProps.width === '100%') {
            enhancedProps.width = containerDimensions.width;
          }

          return React.cloneElement(child, enhancedProps);
        }
      }
      return child;
    });
  };

  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'relative',
        width,
        height,
        maxHeight,
        maxWidth,
        ...sx,
      }}
      {...props}
    >
      <Box
        ref={setScrollRef}
        onScroll={handleScroll}
        role="region"
        aria-label="Scrollable content"
        aria-busy={loading}
        tabIndex={disabled ? -1 : 0}
        sx={{
          width: '100%',
          height: '100%',
          // Use explicit maxHeight when height is 'auto', otherwise inherit from parent
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
        style={{
          scrollBehavior: smoothScroll ? 'smooth' : 'auto',
        }}
      >
        {renderContent()}
      </Box>

      {/* Loading overlay */}
      {loading && (
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
      )}

      {/* Scroll to top button */}
      {scrollToTopButton && !disabled && !loading && (
        <Zoom in={showScrollToTop}>
          <Fab
            size="small"
            aria-label="Scroll to top"
            onClick={scrollToTop}
            sx={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              zIndex: 1,
              backgroundColor:
                variant === 'glass'
                  ? alpha(theme.palette.primary.main, 0.2)
                  : theme.palette.primary.main,
              backdropFilter: variant === 'glass' ? 'blur(10px)' : 'none',
              '&:hover': {
                backgroundColor:
                  variant === 'glass'
                    ? alpha(theme.palette.primary.main, 0.3)
                    : theme.palette.primary.dark,
              },
            }}
          >
            <KeyboardArrowUp />
          </Fab>
        </Zoom>
      )}
    </Box>
  );
};
