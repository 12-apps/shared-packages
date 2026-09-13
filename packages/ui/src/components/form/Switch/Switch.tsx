import Box from '@mui/material/Box/index.js';
import React, { forwardRef, useId } from 'react';

import { splitTestId } from '../../../platform/test-id';
import { withDefaults } from '../../../utils/withDefaults';

import { switchIds } from './Switch.ids';
import { SwitchControl, SwitchHelper, SwitchRow } from './Switch.parts';
import type { SwitchProps } from './Switch.types';

const DEFAULTS = {
  variant: 'default',
  color: 'primary',
  size: 'md',
  glow: false,
  glass: false,
  gradient: false,
  labelPosition: 'end',
  error: false,
  animated: true,
  loading: false,
  ripple: false,
  pulse: false,
} satisfies Partial<SwitchProps>;

type ResolvedProps = SwitchProps & Required<Pick<SwitchProps, keyof typeof DEFAULTS>>;

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>((props, ref) => {
  const {
    variant, color, size, label, description, glow, glass, gradient, labelPosition,
    onIcon, offIcon, onText, offText, error, helperText, trackWidth, trackHeight,
    checked, onChange, animated, loading, ripple, pulse,
    id, inputProps,
    ...others
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const { testId: dataTestId, rest } = splitTestId(others);
  const containerTestId = dataTestId ? `${dataTestId}-container` : 'switch-container';

  // The input needs an id for the label to point at, and the caller usually has
  // no reason to invent one — see {@link switchIds} for the precedence.
  const { inputId, descriptionId, helperId, describedBy } = switchIds({
    generated: useId(),
    id,
    inputProps,
    description,
    helperText,
    callerDescribedBy: rest['aria-describedby'],
  });

  const control = (
    <SwitchControl
      customVariant={variant}
      customColor={color}
      customSize={size}
      glow={glow}
      glass={glass}
      gradient={gradient}
      trackWidth={trackWidth}
      trackHeight={trackHeight}
      onText={onText}
      offText={offText}
      loading={loading}
      ripple={ripple}
      pulse={pulse}
      checked={checked}
      onChange={onChange}
      onIcon={onIcon}
      offIcon={offIcon}
      animated={animated}
      size={size}
      dataTestId={dataTestId}
      switchRef={ref}
      inputId={inputId}
      inputProps={inputProps}
      describedBy={describedBy}
      rest={rest}
    />
  );

  const helper = (
    <SwitchHelper helperText={helperText} error={error} dataTestId={dataTestId} id={helperId} />
  );

  return (
    <Box data-testid={containerTestId}>
      <SwitchRow
        label={label}
        description={description}
        labelPosition={labelPosition}
        error={error}
        dataTestId={dataTestId}
        htmlFor={inputId}
        descriptionId={descriptionId}
        control={control}
      />
      {helper}
    </Box>
  );
});

Switch.displayName = 'Switch';
