import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { LazyImageProps, LazyImageState } from './LazyImage.types';

type LazyImageDefaultedKeys =
  | 'height'
  | 'loadingState'
  | 'objectFit'
  | 'objectPosition'
  | 'lazy'
  | 'rootMargin'
  | 'threshold'
  | 'fadeIn'
  | 'fadeInDuration'
  | 'retryOnError'
  | 'maxRetries'
  | 'retryDelay'
  | 'decoding'
  | 'skeletonProps'
  | 'spinnerProps'
  | 'sx'
  | 'role';

export type ResolvedLazyImageProps = LazyImageProps &
  Required<Pick<LazyImageProps, LazyImageDefaultedKeys>>;

const LAZY_IMAGE_DEFAULTS: Pick<LazyImageProps, LazyImageDefaultedKeys> = {
  height: 'auto',
  loadingState: 'skeleton',
  objectFit: 'cover',
  objectPosition: 'center',
  lazy: true,
  rootMargin: '100px',
  threshold: 0,
  fadeIn: true,
  fadeInDuration: 300,
  retryOnError: false,
  maxRetries: 3,
  retryDelay: 1000,
  decoding: 'async',
  skeletonProps: {},
  spinnerProps: {},
  sx: {},
  role: 'img',
};

// Strips explicitly-undefined props before the merge, so `lazy={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: LazyImageProps): Partial<LazyImageProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<LazyImageProps>;

export const resolveLazyImageProps = (props: LazyImageProps): ResolvedLazyImageProps =>
  ({ ...LAZY_IMAGE_DEFAULTS, ...definedProps(props) }) as ResolvedLazyImageProps;

// Props this component consumes itself. Anything else the caller passed is an
// ordinary <img> attribute and is forwarded untouched.
const OWN_PROPS = new Set([
  'src', 'alt', 'width', 'height', 'placeholder', 'fallback', 'loadingState',
  'showSpinner', 'objectFit', 'objectPosition', 'borderRadius', 'lazy', 'rootMargin',
  'threshold', 'fadeIn', 'fadeInDuration', 'onLoad', 'onError', 'onLoadStart',
  'retryOnError', 'maxRetries', 'retryDelay', 'decoding', 'loading', 'fetchPriority',
  'skeletonProps', 'spinnerProps', 'sx', 'className', 'data-testid', 'aria-label',
  'aria-describedby', 'role',
]);

export const imgPassThrough = (props: ResolvedLazyImageProps): Record<string, unknown> =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_PROPS.has(key)));

/**
 * Flips `isVisible` the first time the container nears the viewport, then stops
 * observing. Does nothing when `lazy` is off — the caller wants the request now.
 */
const useVisibility = (
  props: ResolvedLazyImageProps,
  containerRef: React.RefObject<HTMLDivElement | null>,
  isVisible: boolean,
  onVisible: () => void,
) => {
  const { lazy, src, rootMargin, threshold, onLoadStart } = props;

  useEffect(() => {
    if (!lazy || isVisible) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible();
            onLoadStart?.();
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin, threshold },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, [lazy, src, rootMargin, threshold, isVisible, onLoadStart, onVisible, containerRef]);
};

/** A pending retry has to be cancelled on unmount, or it sets state on a dead component. */
const useRetryTimeout = () => {
  const ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (ref.current) {
        clearTimeout(ref.current);
      }
    },
    [],
  );

  return ref;
};

/**
 * Owns whether the real image has been requested yet and how it went: the
 * observer above, the load/error handlers, and the retry timer.
 */
export const useLazyImage = (props: ResolvedLazyImageProps) => {
  const { src, placeholder, lazy, loadingState, showSpinner } = props;
  const { onLoad, onError, retryOnError, maxRetries, retryDelay } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRetryTimeout();

  // Handle deprecated showSpinner prop
  const effectiveLoadingState = showSpinner ? 'spinner' : loadingState;

  const [state, setState] = useState<LazyImageState>({
    isLoading: true,
    hasError: false,
    isVisible: !lazy, // If not lazy, load immediately
    retryCount: 0,
    currentSrc: lazy ? placeholder || null : src,
  });

  const markVisible = useCallback(
    () => setState((prev) => ({ ...prev, isVisible: true, currentSrc: src })),
    [src],
  );
  useVisibility(props, containerRef, state.isVisible, markVisible);

  // Load image when it becomes visible
  useEffect(() => {
    if (!state.isVisible || !src || state.currentSrc === src) {
      return;
    }

    setState((prev) => ({ ...prev, currentSrc: src, isLoading: true, hasError: false }));
  }, [state.isVisible, src, state.currentSrc]);

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      setState((prev) => ({ ...prev, isLoading: false, hasError: false, retryCount: 0 }));
      onLoad?.(event);
    },
    [onLoad],
  );

  const handleImageError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!retryOnError || state.retryCount >= maxRetries) {
        setState((prev) => ({ ...prev, isLoading: false, hasError: true }));
        onError?.(event);
        return;
      }

      retryTimeoutRef.current = setTimeout(() => {
        setState((prev) => ({
          ...prev,
          retryCount: prev.retryCount + 1,
          currentSrc: `${src}?retry=${prev.retryCount + 1}`, // Force reload with cache buster
        }));
      }, retryDelay);
    },
    [onError, retryOnError, state.retryCount, maxRetries, retryDelay, src],
  );

  return {
    state,
    containerRef,
    effectiveLoadingState,
    handleImageLoad,
    handleImageError,
    showImage: Boolean(state.currentSrc) && !state.hasError,
    showLoading:
      state.isLoading && (!state.currentSrc || effectiveLoadingState !== 'placeholder'),
  };
};
