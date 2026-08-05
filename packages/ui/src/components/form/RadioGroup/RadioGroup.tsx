import { Box, FormHelperText } from '@mui/material';
import React, { forwardRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import type { RadioOption, RadioGroupProps } from './RadioGroup.types';
import {
  ButtonRadios,
  CardRadios,
  DefaultRadios,
  GroupLabel,
  SegmentRadios,
  testId,
} from './RadioGroup.variants';
import type { VariantProps } from './RadioGroup.variants';

const DEFAULTS = {
  variant: 'default',
  color: 'primary',
  size: 'md',
  error: false,
  glassLabel: false,
  glow: false,
  glass: false,
  gradient: false,
  direction: 'column',
  showDescriptions: true,
} satisfies Partial<RadioGroupProps>;

type ResolvedProps = RadioGroupProps & Required<Pick<RadioGroupProps, keyof typeof DEFAULTS>>;

const VARIANTS: Record<string, React.FC<VariantProps>> = {
  cards: CardRadios,
  buttons: ButtonRadios,
  segments: SegmentRadios,
  default: DefaultRadios,
};

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>((props, ref) => {
  const {
    variant, color, size, options, label, error, helperText, glassLabel,
    glow, glass, gradient, direction, showDescriptions, value, onChange, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  // One place that turns a click into the ChangeEvent MUI's onChange expects.
  // The cards, buttons and segments variants each had this written out.
  const handleSelect = (option: RadioOption) => {
    if (option.disabled || !onChange) return;
    const event = { target: { value: option.value } } as React.ChangeEvent<HTMLInputElement>;
    onChange(event, option.value);
  };

  const Variant = VARIANTS[variant] ?? DefaultRadios;

  return (
    <Box data-testid={dataTestId}>
      {label && (
        <GroupLabel glass={glassLabel} error={error} dataTestId={dataTestId}>
          {label}
        </GroupLabel>
      )}

      <Variant
        options={options}
        value={value}
        color={color}
        size={size}
        direction={direction}
        showDescriptions={showDescriptions}
        glass={glass}
        gradient={gradient}
        glow={glow}
        dataTestId={dataTestId}
        onSelect={handleSelect}
        groupRef={ref}
        onChange={onChange}
        rest={rest}
      />

      {helperText && (
        <FormHelperText
          error={error}
          sx={{ mt: 1 }}
          data-testid={testId(dataTestId, 'helper-text')}
        >
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
});

RadioGroup.displayName = 'RadioGroup';
