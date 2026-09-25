import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { styled, useTheme, type Theme } from '@mui/material/styles/index.js';
import React from 'react';
import { Skeleton } from '../../layout/Skeleton';
import type { ResolvedLazyImageProps } from './LazyImage.hooks';
import { imgPassThrough, resolveLazyImageProps, useLazyImage } from './LazyImage.hooks';
import type { LazyImageProps } from './LazyImage.types';
import { sheen } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

const ImageContainer = styled(Box)(() => ({
  position: 'relative',
  display: 'inline-block',
  overflow: 'hidden',
}));

const StyledImage = styled('img')<{
  fadeIn?: boolean;
  fadeInDuration?: number;
  isLoaded?: boolean;
}>(({ fadeIn, fadeInDuration = 300, isLoaded }) => ({
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  opacity: fadeIn ? (isLoaded ? 1 : 0) : 1,
  transition: fadeIn ? `opacity ${fadeInDuration}ms ease-in-out` : 'none',
}));

const SpinnerOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: sheen(theme, 0.8),
  borderRadius: '50%',
  padding: theme.spacing(1),
}));

const FallbackContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.action.disabledBackground,
  color: theme.palette.text.secondary,
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
}));

type Length = number | string | undefined;

/** A length prop as React `style` and MUI's `Skeleton` read it: a number is design px. */
const styleLength = (theme: Theme, value: Length): string | undefined =>
  typeof value === 'number' ? rem(theme, value) : value;

/**
 * A width or height above 0 and up to 1 is a fraction of the container's parent, as in `sx`.
 * A negative number is no fraction: it stays a (negative, so invalid) length.
 */
const isFraction = (value: Length): value is number =>
  typeof value === 'number' && value > 0 && value <= 1;

/**
 * A length prop as `sx` reads it on a width or height: a number of 1 or less is
 * a fraction of the parent, and that stays so; any other number is design px.
 */
const sxLength = (theme: Theme, value: Length): string | undefined =>
  isFraction(value) ? `${value * 100}%` : styleLength(theme, value);

/**
 * A width or height for what is drawn inside the container. The container alone
 * takes a fraction, so everything in it fills it: a percentage here is measured
 * against the container and would stack (FUT-2666). Otherwise the same as `styleLength`.
 */
const innerLength = (theme: Theme, value: Length): string | undefined =>
  isFraction(value) ? '100%' : styleLength(theme, value);

/**
 * A width or height with its default. Only an unset or empty size takes it: `0`
 * is a size, which `||` read as unset (FUT-2669), and `sx` reads `''` as `0%`.
 */
const orDefault = (value: Length, fallback: number | string): number | string =>
  value === undefined || value === '' ? fallback : value;

/** The box the image occupies, as CSS, shared by the real image and every stand-in for it. */
interface BoxMetrics {
  width?: string;
  height?: string;
  objectFit: NonNullable<LazyImageProps['objectFit']>;
  objectPosition: string;
  borderRadius?: string;
}

interface IndicatorProps {
  props: ResolvedLazyImageProps;
  metrics: BoxMetrics;
}

const SkeletonIndicator: React.FC<IndicatorProps> = ({ props }) => {
  const theme = useTheme();
  return (
    <Skeleton
      variant="rectangular"
      width={innerLength(theme, orDefault(props.width, '100%'))}
      height={innerLength(theme, orDefault(props.height, 'auto'))}
      animation={props.skeletonProps.animation || 'pulse'}
      intensity={props.skeletonProps.intensity}
      borderRadius={styleLength(theme, props.borderRadius)}
      data-testid={`${props['data-testid']}-skeleton`}
    />
  );
};

const SpinnerIndicator: React.FC<IndicatorProps> = ({ props }) => {
  const theme = useTheme();
  const { spinnerProps } = props;

  return (
    <SpinnerOverlay>
      <CircularProgress
        size={styleLength(theme, spinnerProps.size || 40)}
        thickness={spinnerProps.thickness || 4}
        sx={{ color: spinnerProps.color || theme.palette.primary.main }}
        data-testid={`${props['data-testid']}-spinner`}
      />
    </SpinnerOverlay>
  );
};

/**
 * The placeholder sits in the box's flow and gives the box its size: the box's
 * own when one is set, the placeholder's when not. The real image is drawn over
 * it (`OVER_PLACEHOLDER`) until it has faded in. Its load and error are not the
 * image's, so neither reaches the caller; a failing one just retires.
 */
const PlaceholderIndicator: React.FC<IndicatorProps & { onError: () => void }> = ({
  props,
  metrics,
  onError,
}) => {
  if (!props.placeholder) return null;

  return (
    <StyledImage
      src={props.placeholder}
      alt={`${props.alt} (loading)`}
      style={metrics}
      decoding={props.decoding}
      loading={props.lazy ? 'lazy' : props.loading}
      onError={onError}
      data-testid={`${props['data-testid']}-placeholder`}
    />
  );
};

const LoadingIndicator: React.FC<
  IndicatorProps & { kind: NonNullable<LazyImageProps['loadingState']>; onPlaceholderError: () => void }
> = ({ kind, onPlaceholderError, ...rest }) => {
  switch (kind) {
    case 'skeleton':
      return <SkeletonIndicator {...rest} />;
    case 'spinner':
      return <SpinnerIndicator {...rest} />;
    case 'placeholder':
      return <PlaceholderIndicator {...rest} onError={onPlaceholderError} />;
    default:
      return null;
  }
};

/**
 * The real image while the placeholder is up: laid over it and cropped by
 * `objectFit`, so the box never grows to hold both. It takes the flow back
 * when the placeholder goes.
 */
const OVER_PLACEHOLDER: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};

const ErrorFallback: React.FC<IndicatorProps> = ({ props, metrics }) => {
  const theme = useTheme();
  const { alt, fallback, width, height, borderRadius } = props;
  const testId = props['data-testid'];

  if (!fallback) return null;

  if (typeof fallback === 'string') {
    return (
      <StyledImage
        src={fallback}
        alt={`${alt} (fallback)`}
        style={metrics}
        fadeIn={false}
        isLoaded={true}
        data-testid={`${testId}-fallback`}
      />
    );
  }

  return (
    <FallbackContainer
      sx={{
        width: innerLength(theme, width),
        height: innerLength(theme, height),
        borderRadius: styleLength(theme, borderRadius),
      }}
      data-testid={`${testId}-fallback`}
    >
      {fallback}
    </FallbackContainer>
  );
};

/**
 * LazyImage component with enhanced features for optimized image loading
 * Supports lazy loading, placeholders, error handling, and various loading states
 */
export const LazyImage = React.memo<LazyImageProps>(function LazyImage(rawProps) {
  const props = resolveLazyImageProps(rawProps);
  const theme = useTheme();
  const {
    state,
    containerRef,
    effectiveLoadingState,
    handleImageLoad,
    handleImageError,
    handlePlaceholderError,
    showImage,
    showLoading,
    showPlaceholder,
  } = useLazyImage(props);

  const { width, height, borderRadius, alt } = props;
  const testId = props['data-testid'];
  const metrics: BoxMetrics = {
    width: innerLength(theme, width),
    height: innerLength(theme, height),
    objectFit: props.objectFit,
    objectPosition: props.objectPosition,
    borderRadius: styleLength(theme, borderRadius),
  };

  return (
    <ImageContainer
      ref={containerRef}
      className={props.className}
      sx={{
        width: sxLength(theme, orDefault(width, 'auto')),
        height: sxLength(theme, orDefault(height, 'auto')),
        // The same px length the image gets (`metrics`): in `sx` a bare number
        // would be a multiple of `shape.borderRadius`, and this box clips (FUT-2656).
        borderRadius: metrics.borderRadius,
      }}
      data-testid={testId}
    >
      {showLoading && (
        <LoadingIndicator
          kind={effectiveLoadingState}
          props={props}
          metrics={metrics}
          onPlaceholderError={handlePlaceholderError}
        />
      )}

      {showImage && (
        <StyledImage
          src={state.currentSrc || undefined}
          alt={alt}
          onLoad={handleImageLoad}
          onError={handleImageError}
          fadeIn={props.fadeIn}
          fadeInDuration={props.fadeInDuration}
          isLoaded={!state.isLoading}
          decoding={props.decoding}
          loading={props.lazy ? 'lazy' : props.loading}
          style={{ ...metrics, ...props.sx, ...(showPlaceholder && OVER_PLACEHOLDER) }}
          aria-label={props['aria-label'] || alt}
          aria-describedby={props['aria-describedby']}
          role={props.role}
          data-testid={`${testId}-img`}
          {...imgPassThrough(props)}
        />
      )}

      {state.hasError && <ErrorFallback props={props} metrics={metrics} />}
    </ImageContainer>
  );
});

LazyImage.displayName = 'LazyImage';
