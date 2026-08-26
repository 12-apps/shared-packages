import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Fab from '@mui/material/Fab/index.js';
import Zoom from '@mui/material/Zoom/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ResolvedScrollAreaProps } from './ScrollArea.helpers';
import { resolveScrollAreaProps } from './ScrollArea.helpers';
import type { ScrollAreaProps } from './ScrollArea.types';
import { ScrollAreaContent } from './ScrollAreaContent';
import { ScrollViewport } from './ScrollViewport';

// Owns the scroll container ref (merging in any ref the caller passed) and
// reports size changes through a ResizeObserver.
const useObservedScrollRef = ({
  externalScrollRef,
  onResize }: {
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
// The scrollbar shows while scrolling and hides once movement stops.
const useAutoHide = ({
  autoHide,
  alwaysShowScrollbar,
  autoHideDelay }: {
  autoHide: boolean;
  alwaysShowScrollbar: boolean;
  autoHideDelay: number;
}) => {
  const [isScrolling, setIsScrolling] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  const noteScroll = useCallback(() => {
    if (!autoHide || alwaysShowScrollbar) return;

    setIsScrolling(true);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setIsScrolling(false), autoHideDelay);
  }, [autoHide, alwaysShowScrollbar, autoHideDelay]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  return { isScrolling, noteScroll };
};

const useScrollArea = (
  props: ResolvedScrollAreaProps & { externalScrollRef?: React.Ref<HTMLDivElement> },
) => {
  const {
    disabled,
    onScroll,
    onResize,
    externalScrollRef,
    autoHide,
    autoHideDelay,
    alwaysShowScrollbar,
    scrollToTopButton,
    scrollToTopThreshold,
    smoothScroll } = props;

  const { scrollRef, setScrollRef, containerDimensions } = useObservedScrollRef({
    externalScrollRef,
    onResize });
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const { isScrolling, noteScroll } = useAutoHide({
    autoHide,
    alwaysShowScrollbar,
    autoHideDelay });

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (disabled) return;

      noteScroll();

      if (scrollToTopButton && scrollRef.current) {
        setShowScrollToTop(scrollRef.current.scrollTop > scrollToTopThreshold);
      }

      onScroll?.(event);
    },
    [disabled, noteScroll, scrollToTopButton, scrollToTopThreshold, onScroll, scrollRef],
  );

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
    scrollToTop };
};

const LoadingOverlay: FC = () => (
  <Box
    sx={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 10 }}
  >
    <CircularProgress />
  </Box>
);

// The label is guarded at the call site rather than defaulted: the props union
// already makes it required alongside `scrollToTopButton`, and a fab with an
// empty accessible name is the exact failure this port exists to remove.
const ScrollToTopFab: FC<{
  visible: boolean;
  glass: boolean;
  scrollToTopLabel: string;
  onClick: () => void;
}> = ({
  visible,
  glass,
  scrollToTopLabel,
  onClick }) => {
  const theme = useTheme();

  return (
    <Zoom in={visible}>
      <Fab
        size="small"
        aria-label={scrollToTopLabel}
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
              : theme.palette.primary.dark } }}
      >
        <KeyboardArrowUp />
      </Fab>
    </Zoom>
  );
};

export const ScrollArea: React.FC<ScrollAreaProps> = (componentProps) => {
  const resolved = resolveScrollAreaProps(componentProps);
  const {
    regionLabel,
    scrollToTopLabel,
    children,
    width,
    height,
    maxHeight,
    maxWidth,
    orientation: _orientation,
    scrollbarSize: _scrollbarSize,
    autoHide,
    autoHideDelay: _autoHideDelay,
    smoothScroll: _smoothScroll,
    variant,
    onScroll: _onScroll,
    scrollToTopButton,
    scrollToTopThreshold: _scrollToTopThreshold,
    scrollbarColor: _scrollbarColor,
    scrollbarTrackColor: _scrollbarTrackColor,
    contentPadding: _contentPadding,
    alwaysShowScrollbar,
    disabled,
    loading,
    emptyContent,
    testId,
    scrollRef: externalScrollRef,
    onResize: _onResize,
    sx,
    ...props
  } = resolved;

  const {
    scrollRef,
    setScrollRef,
    isScrolling,
    showScrollToTop,
    containerDimensions,
    handleScroll,
    scrollToTop } = useScrollArea({ ...resolved, externalScrollRef });

  // Auto-hide keeps the scrollbar out of the way until the user is scrolling.
  const shouldShowScrollbar = alwaysShowScrollbar || !autoHide || isScrolling;

  return (
    <Box
      data-testid={testId}
      sx={{ position: 'relative', width, height, maxHeight, maxWidth, ...sx }}
      {...props}
    >
      <ScrollViewport
        {...resolved}
        regionLabel={regionLabel}
        shouldShowScrollbar={shouldShowScrollbar}
        setScrollRef={setScrollRef}
        onScroll={handleScroll}
      >
        <ScrollAreaContent
          emptyContent={emptyContent}
          scrollRef={scrollRef}
          containerWidth={containerDimensions.width}
        >
          {children}
        </ScrollAreaContent>
      </ScrollViewport>

      {loading && <LoadingOverlay />}

      {scrollToTopButton && scrollToTopLabel && !disabled && !loading && (
        <ScrollToTopFab
          scrollToTopLabel={scrollToTopLabel}
          visible={showScrollToTop}
          glass={variant === 'glass'}
          onClick={scrollToTop}
        />
      )}
    </Box>
  );
};
