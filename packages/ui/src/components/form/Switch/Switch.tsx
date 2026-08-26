import Box from '@mui/material/Box';
import React, { forwardRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import {
  LabelContainer,
  SwitchControl,
  SwitchHelper,
  SwitchLabel,
} from './Switch.parts';
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
    checked, onChange, animated, loading, ripple, pulse, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const containerTestId = dataTestId ? `${dataTestId}-container` : 'switch-container';

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
      rest={rest}
    />
  );

  const helper = <SwitchHelper helperText={helperText} error={error} dataTestId={dataTestId} />;

  if (!label) {
    return (
      <Box data-testid={containerTestId}>
        {control}
        {helper}
      </Box>
    );
  }

  return (
    <Box data-testid={containerTestId}>
      <LabelContainer labelPosition={labelPosition} error={error}>
        {labelPosition === 'start' && control}

        <SwitchLabel
          label={label}
          description={description}
          error={error}
          dataTestId={dataTestId}
        />

        {labelPosition !== 'start' && control}
      </LabelContainer>

      {helper}
    </Box>
  );
});

Switch.displayName = 'Switch';
