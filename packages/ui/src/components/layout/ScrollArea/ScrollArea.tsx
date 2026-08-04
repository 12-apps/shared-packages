import type { Theme } from '@mui/material';
import { Box, useTheme } from '@mui/material';
import React, { useCallback,useEffect, useRef, useState } from 'react';

import {
  getOverflowStyle,
  getVariantStyles,
} from './ScrollArea.styles';
import { LoadingOverlay, ScrollAreaContent, ScrollToTopButton } from './ScrollArea.parts';
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

// The transient "is scrolling" flag that drives auto-hide. Its timer is the only
// thing here that outlives a render, so it owns the unmount cleanup too.
const useAutoHideFlag = ({
  autoHide,
  autoHideDelay,
  alwaysShowScrollbar,
}: {
  autoHide?: boolean;
  autoHideDelay?: number;
  alwaysShowScrollbar?: boolean;
}) => {
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | undefined>(undefined);

  // Clean up timeout on unmount
  useEffect(
    () => () => {
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    },
    [],
  );

  const markScrolling = useCallback(() => {
    if (!autoHide || alwaysShowScrollbar) return;

    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => setIsScrolling(false), autoHideDelay);
  }, [autoHide, alwaysShowScrollbar, autoHideDelay]);

  return { isScrolling, markScrolling };
};

// Scroll position, the observed container size, and the scroll-to-top
// affordance, composed over the ref and auto-hide hooks above.
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
  const { isScrolling, markScrolling } = useAutoHideFlag({
    autoHide,
    autoHideDelay,
    alwaysShowScrollbar,
  });

  // Handle scroll event
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (disabled) return;

      markScrolling();

      // Check if should show scroll to top button
      if (scrollToTopButton && scrollRef.current) {
        setShowScrollToTop(scrollRef.current.scrollTop > scrollToTopThreshold);
      }

      onScroll?.(event);
    },
    [disabled, markScrolling, scrollToTopButton, scrollToTopThreshold, onScroll, scrollRef],
  );

  // Scroll to top function
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: smoothScroll ? 'smooth' : 'auto' });
  }, [smoothScroll, scrollRef]);

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

// Prop defaults sit in these two resolvers rather than the component's own
// parameter list: fifteen `= default` branches would spend the whole complexity
// budget before the render's first conditional. Split in two so neither
// resolver reaches the limit either.
type Appearance = Pick<
  ScrollAreaProps,
  'width' | 'height' | 'orientation' | 'scrollbarSize' | 'variant' | 'contentPadding' | 'testId'
>;

const resolveAppearance = ({
  width = '100%',
  height = '100%',
  orientation = 'vertical',
  scrollbarSize = 'medium',
  variant = 'default',
  contentPadding = 0,
  testId = 'scroll-area',
}: Appearance) => ({ width, height, orientation, scrollbarSize, variant, contentPadding, testId });

type Behaviour = Pick<
  ScrollAreaProps,
  | 'autoHide'
  | 'autoHideDelay'
  | 'smoothScroll'
  | 'scrollToTopButton'
  | 'scrollToTopThreshold'
  | 'alwaysShowScrollbar'
  | 'disabled'
  | 'loading'
>;

const resolveBehaviour = ({
  autoHide = true,
  autoHideDelay = 1000,
  smoothScroll = true,
  scrollToTopButton = false,
  scrollToTopThreshold = 100,
  alwaysShowScrollbar = false,
  disabled = false,
  loading = false,
}: Behaviour) => ({
  autoHide,
  autoHideDelay,
  smoothScroll,
  scrollToTopButton,
  scrollToTopThreshold,
  alwaysShowScrollbar,
  disabled,
  loading,
});

// The scrollable surface's own styling, kept out of the component so its
// conditionals are measured here rather than against the render.
const buildSurfaceSx = ({
  theme,
  height,
  maxHeight,
  contentPadding,
  loading,
  disabled,
  variant,
  orientation,
  scrollbarSize,
  scrollbarColor,
  scrollbarTrackColor,
  shouldShowScrollbar,
}: Appearance &
  Pick<ScrollAreaProps, 'maxHeight' | 'scrollbarColor' | 'scrollbarTrackColor'> & {
    theme: Theme;
    loading: boolean;
    disabled: boolean;
    shouldShowScrollbar: boolean;
  }) => ({
  width: '100%',
  height: '100%',
  // Use explicit maxHeight when height is 'auto', otherwise inherit from parent
  maxHeight: height === 'auto' && maxHeight ? maxHeight : '100%',
  padding: contentPadding,
  opacity: loading ? 0.5 : 1,
  pointerEvents: disabled || loading ? ('none' as const) : ('auto' as const),
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
});

export const ScrollArea: React.FC<ScrollAreaProps> = ({
  children, width, height, maxHeight, maxWidth, orientation, scrollbarSize,
  autoHide, autoHideDelay, smoothScroll, variant, onScroll, scrollToTopButton,
  scrollToTopThreshold, scrollbarColor, scrollbarTrackColor, contentPadding,
  alwaysShowScrollbar, disabled, loading, emptyContent, testId,
  scrollRef: externalScrollRef, onResize, sx, ...props
}) => {
  const theme = useTheme();
  const appearance = resolveAppearance({
    width, height, orientation, scrollbarSize, variant, contentPadding, testId,
  });
  const behaviour = resolveBehaviour({
    autoHide, autoHideDelay, smoothScroll, scrollToTopButton,
    scrollToTopThreshold, alwaysShowScrollbar, disabled, loading,
  });
  const {
    scrollRef,
    setScrollRef,
    isScrolling,
    showScrollToTop,
    containerDimensions,
    handleScroll,
    scrollToTop,
  } = useScrollArea({ ...behaviour, onScroll, onResize, externalScrollRef });

  const shouldShowScrollbar =
    behaviour.alwaysShowScrollbar || !behaviour.autoHide || isScrolling;

  return (
    <Box
      data-testid={appearance.testId}
      sx={{
        position: 'relative',
        width: appearance.width,
        height: appearance.height,
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
        aria-busy={behaviour.loading}
        tabIndex={behaviour.disabled ? -1 : 0}
        sx={buildSurfaceSx({
          ...appearance,
          theme,
          maxHeight,
          loading: behaviour.loading,
          disabled: behaviour.disabled,
          scrollbarColor,
          scrollbarTrackColor,
          shouldShowScrollbar,
        })}
        style={{ scrollBehavior: behaviour.smoothScroll ? 'smooth' : 'auto' }}
      >
        <ScrollAreaContent
          emptyContent={emptyContent}
          scrollRef={scrollRef}
          containerWidth={containerDimensions.width}
        >
          {children}
        </ScrollAreaContent>
      </Box>

      <LoadingOverlay loading={behaviour.loading} />

      <ScrollToTopButton
        visible={behaviour.scrollToTopButton && !behaviour.disabled && !behaviour.loading}
        shown={showScrollToTop}
        glass={appearance.variant === 'glass'}
        onClick={scrollToTop}
      />
    </Box>
  );
};
