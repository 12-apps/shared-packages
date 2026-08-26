import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';
import { Skeleton } from '../../layout/Skeleton';
import type { ResolvedLazyImageProps } from './LazyImage.hooks';
import { imgPassThrough, resolveLazyImageProps, useLazyImage } from './LazyImage.hooks';
import type { LazyImageProps } from './LazyImage.types';

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
  backgroundColor: 'rgba(255, 255, 255, 0.8)',
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

/** The box the image occupies, shared by the real image and every stand-in for it. */
interface BoxMetrics {
  width?: number | string;
  height?: number | string;
  objectFit: NonNullable<LazyImageProps['objectFit']>;
  objectPosition: string;
  borderRadius?: number | string;
}

interface IndicatorProps {
  props: ResolvedLazyImageProps;
  metrics: BoxMetrics;
}

const SkeletonIndicator: React.FC<IndicatorProps> = ({ props, metrics }) => (
  <Skeleton
    variant="rectangular"
    width={metrics.width || '100%'}
    height={metrics.height || 200}
    animation={props.skeletonProps.animation || 'pulse'}
    intensity={props.skeletonProps.intensity}
    borderRadius={props.borderRadius}
    data-testid={`${props['data-testid']}-skeleton`}
  />
);

const SpinnerIndicator: React.FC<IndicatorProps> = ({ props }) => {
  const theme = useTheme();
  const { spinnerProps } = props;

  return (
    <SpinnerOverlay>
      <CircularProgress
        size={spinnerProps.size || 40}
        thickness={spinnerProps.thickness || 4}
        sx={{ color: spinnerProps.color || theme.palette.primary.main }}
        data-testid={`${props['data-testid']}-spinner`}
      />
    </SpinnerOverlay>
  );
};

const PlaceholderIndicator: React.FC<IndicatorProps & { hasSrc: boolean }> = ({
  props,
  metrics,
  hasSrc,
}) => {
  // Once a src has been chosen the real <img> is on screen, so the placeholder
  // would only stack behind it.
  if (!props.placeholder || hasSrc) return null;

  return (
    <StyledImage
      src={props.placeholder}
      alt={`${props.alt} (loading)`}
      style={metrics}
      data-testid={`${props['data-testid']}-placeholder`}
    />
  );
};

const LoadingIndicator: React.FC<
  IndicatorProps & { kind: NonNullable<LazyImageProps['loadingState']>; hasSrc: boolean }
> = ({ kind, hasSrc, ...rest }) => {
  switch (kind) {
    case 'skeleton':
      return <SkeletonIndicator {...rest} />;
    case 'spinner':
      return <SpinnerIndicator {...rest} />;
    case 'placeholder':
      return <PlaceholderIndicator {...rest} hasSrc={hasSrc} />;
    default:
      return null;
  }
};

const ErrorFallback: React.FC<IndicatorProps> = ({ props, metrics }) => {
  const { alt, fallback, borderRadius } = props;
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
      sx={{ width: metrics.width, height: metrics.height, borderRadius }}
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
  const {
    state,
    containerRef,
    effectiveLoadingState,
    handleImageLoad,
    handleImageError,
    showImage,
    showLoading,
  } = useLazyImage(props);

  const { width, height, borderRadius, alt } = props;
  const testId = props['data-testid'];
  const metrics: BoxMetrics = {
    width,
    height,
    objectFit: props.objectFit,
    objectPosition: props.objectPosition,
    borderRadius,
  };

  return (
    <ImageContainer
      ref={containerRef}
      className={props.className}
      sx={{ width: width || 'auto', height: height || 'auto', borderRadius }}
      data-testid={testId}
    >
      {showLoading && (
        <LoadingIndicator
          kind={effectiveLoadingState}
          props={props}
          metrics={metrics}
          hasSrc={Boolean(state.currentSrc)}
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
          style={{ ...metrics, ...props.sx }}
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
