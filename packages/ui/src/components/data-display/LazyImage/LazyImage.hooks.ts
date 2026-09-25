import { useTheme } from '@mui/material/styles/index.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { remPx } from '../../../tokens/relative';

import type { LazyImageProps, LazyImageState } from './LazyImage.types';

type LazyImageDefaultedKeys =
  | 'height'
  | 'loadingState'
  | 'objectFit'
  | 'objectPosition'
  | 'lazy'
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
  const { lazy, src, threshold, onLoadStart } = props;
  const theme = useTheme();
  // `IntersectionObserver` takes px or %, never rem: the default reach is 100
  // design px, measured through the theme so it moves with the root.
  const rootMargin = props.rootMargin ?? `${remPx(theme, 100)}px`;

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

/** A pending timer has to be cancelled on unmount, or it sets state on a dead component. */
const useTimeoutRef = () => {
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
 * Whether the placeholder image is up. It is a loading state: only
 * `loadingState="placeholder"` with a `placeholder` set draws it, from mount
 * until the real image settles — its `load` plus the fade, or its final error.
 * A placeholder that fails to load retires at once, as if none were set.
 */
const usePlaceholderPhase = (
  props: ResolvedLazyImageProps,
  loadingState: NonNullable<LazyImageProps['loadingState']>,
) => {
  const { placeholder, fadeIn, fadeInDuration } = props;
  // Only this mode draws a placeholder. Otherwise the real image settling
  // retires the phase at once — batched into the load's own render, with no
  // timer — so a placeholder switched on afterwards never covers a loaded image.
  const active = loadingState === 'placeholder' && Boolean(placeholder);
  const [retired, setRetired] = useState(false);
  const fadeTimeoutRef = useTimeoutRef();

  const retire = useCallback(() => setRetired(true), []);

  // The real image fades in over the placeholder, so it goes when the fade ends.
  const retireAfterFade = useCallback(() => {
    if (!active || !fadeIn) {
      setRetired(true);
      return;
    }
    clearTimeout(fadeTimeoutRef.current);
    fadeTimeoutRef.current = setTimeout(() => setRetired(true), fadeInDuration);
  }, [active, fadeIn, fadeInDuration, fadeTimeoutRef]);

  return {
    showPlaceholder: active && !retired,
    retirePlaceholder: retire,
    retirePlaceholderAfterFade: retireAfterFade,
  };
};

/**
 * The real image's state, and when it is requested: at once when not lazy,
 * else the first time the container nears the viewport. The main <img> only
 * ever carries the real src — a placeholder is drawn by its own element, so its
 * load and error are never the image's.
 */
const useImageSource = (
  props: ResolvedLazyImageProps,
  containerRef: React.RefObject<HTMLDivElement | null>,
) => {
  const { src, lazy } = props;
  const [state, setState] = useState<LazyImageState>({
    isLoading: true,
    hasError: false,
    isVisible: !lazy, // If not lazy, load immediately
    retryCount: 0,
    currentSrc: lazy ? null : src,
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

  return [state, setState] as const;
};

/**
 * Owns whether the real image has been requested yet and how it went: the
 * observer above, the load/error handlers, the retry timer, and how long the
 * placeholder stays up.
 */
export const useLazyImage = (props: ResolvedLazyImageProps) => {
  const { src, loadingState, showSpinner } = props;
  const { onLoad, onError, retryOnError, maxRetries, retryDelay } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useTimeoutRef();
  const [state, setState] = useImageSource(props, containerRef);

  // Handle deprecated showSpinner prop
  const effectiveLoadingState = showSpinner ? 'spinner' : loadingState;
  const { showPlaceholder, retirePlaceholder, retirePlaceholderAfterFade } = usePlaceholderPhase(
    props,
    effectiveLoadingState,
  );

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      setState((prev) => ({ ...prev, isLoading: false, hasError: false, retryCount: 0 }));
      retirePlaceholderAfterFade();
      onLoad?.(event);
    },
    [onLoad, retirePlaceholderAfterFade],
  );

  const handleImageError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!retryOnError || state.retryCount >= maxRetries) {
        setState((prev) => ({ ...prev, isLoading: false, hasError: true }));
        retirePlaceholder();
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
    [onError, retryOnError, state.retryCount, maxRetries, retryDelay, src, retirePlaceholder],
  );

  return {
    state,
    containerRef,
    effectiveLoadingState,
    handleImageLoad,
    handleImageError,
    handlePlaceholderError: retirePlaceholder,
    showImage: Boolean(state.currentSrc) && !state.hasError,
    // In placeholder mode the placeholder outlasts `isLoading`: it stays under
    // the real image until the fade has ended.
    showLoading: effectiveLoadingState === 'placeholder' ? showPlaceholder : state.isLoading,
    showPlaceholder,
  };
};
