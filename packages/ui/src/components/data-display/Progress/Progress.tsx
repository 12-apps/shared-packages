import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import LinearProgress from '@mui/material/LinearProgress/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { resolveProgressProps } from './Progress.helpers';
import {
  barEmphasisStyles,
  barVariantStyles,
  circularEmphasisStyles,
  getColorFromTheme,
  getSizeStyles,
  pulseAnimation,
} from './Progress.styles';
import type { ProgressProps, ProgressSize, ProgressVariant } from './Progress.types';

const StyledLinearProgress = styled(LinearProgress, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customSize', 'customColor', 'glow', 'pulse'].includes(prop as string),
})<{
  customVariant?: ProgressVariant;
  customSize?: ProgressSize;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customVariant, customSize, customColor = 'primary', glow, pulse }) => {
  const colorPalette = getColorFromTheme(theme, customColor);
  const sizeStyles = getSizeStyles(customSize);

  return {
    height: sizeStyles.height,
    borderRadius: sizeStyles.height / 2,
    backgroundColor: alpha(colorPalette.main, 0.1),

    '& .MuiLinearProgress-bar': {
      borderRadius: 'inherit',
      transition: 'all 0.3s ease',
      ...barVariantStyles(customVariant, colorPalette),
      ...barEmphasisStyles(colorPalette, glow, pulse),
    },
  };
});

const StyledCircularProgress = styled(CircularProgress, {
  shouldForwardProp: (prop) => !['customColor', 'glow', 'pulse'].includes(prop as string),
})<{
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customColor = 'primary', glow, pulse }) => {
  const colorPalette = getColorFromTheme(theme, customColor);

  return {
    color: colorPalette.main,
    ...circularEmphasisStyles(colorPalette, glow, pulse),
  };
});

const SegmentedProgress: React.FC<{
  value?: number;
  segments: number;
  color: string;
  size: ProgressSize;
  glow: boolean;
  pulse: boolean;
  dataTestId?: string;
}> = ({ value = 0, segments, color, size, glow, pulse, dataTestId }) => {
  const theme = useTheme();
  const colorPalette = getColorFromTheme(theme, color);
  const sizeStyles = getSizeStyles(size);
  const filledSegments = Math.floor((value / 100) * segments);

  return (
    <Box sx={{ display: 'flex', gap: 0.5, width: '100%' }} data-testid={`${dataTestId}-segments-container`}>
      {Array.from({ length: segments }, (_, index) => (
        <Box
          key={index}
          data-testid={`${dataTestId}-segment-${index}`}
          sx={{
            flex: 1,
            height: sizeStyles.height,
            borderRadius: sizeStyles.height / 2,
            backgroundColor:
              index < filledSegments ? colorPalette.main : alpha(colorPalette.main, 0.1),
            transition: 'all 0.3s ease',
            ...(glow &&
              index < filledSegments && {
                boxShadow: `0 0 6px 1px ${alpha(colorPalette.main, 0.4)}`,
              }),
            ...(pulse &&
              index < filledSegments && {
                animation: `${pulseAnimation} 2s infinite`,
              }),
          }}
        />
      ))}
    </Box>
  );
};

interface ViewProps {
  size: ProgressSize;
  color: string;
  glow: boolean;
  pulse: boolean;
  showLabel: boolean;
  displayValue: number;
  displayLabel: string;
  /** Absent means indeterminate — the bar animates rather than reporting progress. */
  value?: number;
  dataTestId: string;
}

const ProgressLabel: React.FC<{ size: ProgressSize; label: string; testId: string }> = ({
  size,
  label,
  testId,
}) => (
  <Typography
    variant="caption"
    sx={{
      display: 'block',
      textAlign: 'center',
      mt: 1,
      fontSize: getSizeStyles(size).fontSize,
      fontWeight: 600,
    }}
    data-testid={testId}
  >
    {label}
  </Typography>
);

const CircularView = React.forwardRef<
  HTMLDivElement,
  ViewProps & { thickness: number; circularSize?: number }
>(
  (
    {
      size,
      color,
      glow,
      pulse,
      showLabel,
      displayValue,
      displayLabel,
      value,
      dataTestId,
      thickness,
      circularSize,
      ...props
    },
    ref,
  ) => {
    const sizeStyles = getSizeStyles(size);

    return (
      <Box ref={ref} sx={{ position: 'relative', display: 'inline-flex' }} data-testid={dataTestId}>
        <StyledCircularProgress
          variant={value !== undefined ? 'determinate' : 'indeterminate'}
          value={displayValue}
          size={circularSize || sizeStyles.circularSize}
          thickness={thickness}
          customColor={color}
          glow={glow}
          pulse={pulse}
          data-testid={`${dataTestId}-circular`}
          {...props}
        />
        {showLabel && value !== undefined && (
          <Box
            sx={{
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography
              variant="caption"
              component="div"
              color="text.secondary"
              sx={{ fontSize: sizeStyles.fontSize, fontWeight: 600 }}
              data-testid={`${dataTestId}-label`}
            >
              {displayLabel}
            </Typography>
          </Box>
        )}
      </Box>
    );
  },
);

CircularView.displayName = 'ProgressCircularView';

const SegmentedView = React.forwardRef<HTMLDivElement, ViewProps & { segments: number }>(
  (
    { size, color, glow, pulse, showLabel, displayValue, displayLabel, dataTestId, segments, value: _value, ...props },
    ref,
  ) => (
    <Box ref={ref} sx={{ width: '100%' }} data-testid={dataTestId} {...props}>
      <SegmentedProgress
        value={displayValue}
        segments={segments}
        color={color}
        size={size}
        glow={glow}
        pulse={pulse}
        dataTestId={dataTestId}
      />
      {showLabel && (
        <ProgressLabel size={size} label={displayLabel} testId={`${dataTestId}-label`} />
      )}
    </Box>
  ),
);

SegmentedView.displayName = 'ProgressSegmentedView';

const LinearView = React.forwardRef<HTMLDivElement, ViewProps & { variant: ProgressVariant }>(
  (
    { size, color, glow, pulse, showLabel, displayValue, displayLabel, value, dataTestId, variant, ...props },
    ref,
  ) => (
    <Box ref={ref} sx={{ width: '100%' }} data-testid={dataTestId}>
      <StyledLinearProgress
        variant={value !== undefined ? 'determinate' : 'indeterminate'}
        value={displayValue}
        customVariant={variant}
        customSize={size}
        customColor={color}
        glow={glow}
        pulse={pulse}
        data-testid={`${dataTestId}-linear`}
        {...props}
      />
      {showLabel && (
        <ProgressLabel size={size} label={displayLabel} testId={`${dataTestId}-label`} />
      )}
    </Box>
  ),
);

LinearView.displayName = 'ProgressLinearView';

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (rawProps, ref) => {
    const {
      variant,
      size,
      color,
      glow,
      pulse,
      showLabel,
      label,
      segments,
      thickness,
      circularSize,
      value,
      dataTestId,
      // LinearProgressProps carries a `ref` typed for its own element; the
      // forwarded one below is the ref that matters.
      ref: _ref,
      ...props
    } = resolveProgressProps(rawProps);
    const displayValue = value || 0;
    const shared = {
      size,
      color,
      glow,
      pulse,
      showLabel,
      displayValue,
      displayLabel: label || (showLabel ? `${Math.round(displayValue)}%` : ''),
      value,
      dataTestId,
      ...props,
    };

    if (variant === 'circular') {
      return (
        <CircularView ref={ref} {...shared} thickness={thickness} circularSize={circularSize} />
      );
    }

    if (variant === 'segmented') {
      return <SegmentedView ref={ref} {...shared} segments={segments} />;
    }

    return <LinearView ref={ref} {...shared} variant={variant} />;
  },
);

Progress.displayName = 'Progress';
