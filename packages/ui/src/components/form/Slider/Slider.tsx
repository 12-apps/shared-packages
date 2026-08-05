import { Box, Slider as MuiSlider, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import React, { forwardRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { sliderSx } from './Slider.styles';
import type { SliderFlags } from './Slider.styles';
import type { SliderProps } from './Slider.types';

const StyledSlider = styled(MuiSlider, {
  shouldForwardProp: (prop) =>
    !['customColor', 'customSize', 'glow', 'glass', 'gradient', 'customVariant'].includes(
      prop as string,
    ),
})<SliderFlags>(({ theme, ...flags }) => ({ ...sliderSx(theme, flags) }));

const DEFAULTS = {
  variant: 'default',
  color: 'primary',
  size: 'md',
  showValue: false,
  glow: false,
  glass: false,
  gradient: false,
  showMarks: false,
  unit: '',
} satisfies Partial<SliderProps>;

type ResolvedProps = SliderProps & Required<Pick<SliderProps, keyof typeof DEFAULTS>>;

/** One end of the value, formatted by the caller's formatter if it supplied one. */
const formatOne = (n: number, unit: string, formatValue?: (v: number) => string) =>
  `${formatValue ? formatValue(n) : n}${unit}`;

/** A range renders as `low - high`; a single value on its own. */
const displayValueOf = (
  value: SliderProps['value'],
  unit: string,
  formatValue?: (v: number) => string,
) => {
  if (Array.isArray(value)) {
    const low = formatOne(value[0] ?? 0, unit, formatValue);
    const high = formatOne(value[1] ?? 0, unit, formatValue);
    return `${low} - ${high}`;
  }

  return formatOne((value as number) ?? 0, unit, formatValue);
};

/**
 * Marks come from `customMarks` when given. Otherwise the `marks` variant asks
 * MUI to derive them from the step, and anything else shows none.
 */
const marksFor = (variant: string, showMarks: boolean, customMarks: SliderProps['customMarks']) => {
  if (variant !== 'marks' && !showMarks) return undefined;
  return customMarks || (variant === 'marks' ? true : undefined);
};

export const Slider = forwardRef<HTMLSpanElement, SliderProps>((props, ref) => {
  const {
    variant, color, size, label, showValue, glow, glass, gradient,
    showMarks, customMarks, unit, formatValue, value, onChange, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const testId = (suffix: string) => (dataTestId ? `${dataTestId}-${suffix}` : undefined);

  return (
    <Box sx={{ width: '100%' }} data-testid={dataTestId}>
      {(label || showValue) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
          }}
        >
          {label && (
            <Typography
              variant="body2"
              fontWeight={500}
              color="text.primary"
              data-testid={testId('label')}
            >
              {label}
            </Typography>
          )}
          {showValue && (
            <Typography variant="body2" color="text.secondary" data-testid={testId('value-label')}>
              {displayValueOf(value, unit, formatValue)}
            </Typography>
          )}
        </Box>
      )}

      <Box sx={{ px: 1 }}>
        <StyledSlider
          ref={ref}
          customColor={color}
          customSize={size}
          glow={glow}
          glass={glass}
          gradient={gradient}
          customVariant={variant}
          value={value}
          onChange={onChange}
          marks={marksFor(variant, showMarks, customMarks)}
          valueLabelDisplay={showValue ? 'auto' : 'off'}
          data-testid={testId('slider')}
          slotProps={{
            track: { 'data-testid': testId('track') } as React.HTMLAttributes<HTMLSpanElement>,
            thumb: { 'data-testid': testId('thumb') } as React.HTMLAttributes<HTMLSpanElement>,
          }}
          {...rest}
        />
      </Box>
    </Box>
  );
});

Slider.displayName = 'Slider';
