import { Box, TextField } from '@mui/material';
import { styled } from '@mui/material';
import React, { forwardRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { useOtpDigits } from './InputOTP.hooks';
import { otpSlotSx } from './InputOTP.styles';
import type { OtpSlotFlags } from './InputOTP.styles';
import type { InputOTPProps } from './InputOTP.types';

const StyledOTPInput = styled(TextField, {
  shouldForwardProp: (prop) =>
    !['customColor', 'customSize', 'glass', 'gradient'].includes(prop as string),
})<OtpSlotFlags>(({ theme, ...flags }) => ({ ...otpSlotSx(theme, flags) }));

const DEFAULTS = {
  variant: 'numeric',
  color: 'primary',
  size: 'md',
  length: 6,
  value: '',
  glass: false,
  gradient: false,
  autoFocus: false,
  error: false,
  disabled: false,
} satisfies Partial<InputOTPProps>;

type ResolvedProps = InputOTPProps & Required<Pick<InputOTPProps, keyof typeof DEFAULTS>>;

export const InputOTP = forwardRef<HTMLDivElement, InputOTPProps>((props, ref) => {
  const {
    variant, color, size, length, value, onChange, onComplete,
    glass, gradient, autoFocus, error, disabled, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const { digits, inputRefs, handleInputChange, handleKeyDown, handlePaste } = useOtpDigits({
    variant,
    length,
    value,
    onChange,
    onComplete,
  });

  return (
    <Box
      ref={ref}
      data-testid={dataTestId}
      sx={{ display: 'flex', gap: 1, justifyContent: 'center', alignItems: 'center' }}
      {...rest}
    >
      {digits.map((digit, index) => (
        <StyledOTPInput
          key={index}
          ref={(el: HTMLDivElement | null) => {
            inputRefs.current[index] = el?.querySelector('input') || null;
          }}
          customColor={color}
          customSize={size}
          glass={glass}
          gradient={gradient}
          // `masked` keeps the digit in state and shows a bullet in its place.
          value={variant === 'masked' ? (digit ? '•' : '') : digit}
          onChange={(e) => handleInputChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          // Only the first slot takes a paste; it fills the rest itself.
          onPaste={index === 0 ? handlePaste : undefined}
          autoFocus={autoFocus && index === 0}
          error={error}
          disabled={disabled}
          inputProps={{
            maxLength: 1,
            style: { textAlign: 'center' },
            'data-testid': dataTestId ? `${dataTestId}-slot-${index}` : undefined,
          }}
        />
      ))}
    </Box>
  );
});

InputOTP.displayName = 'InputOTP';
