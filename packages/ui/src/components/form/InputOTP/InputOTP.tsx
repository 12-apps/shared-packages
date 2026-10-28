import Box from '@mui/material/Box/index.js';
import TextField from '@mui/material/TextField/index.js';
import { styled } from '@mui/material/styles/index.js';
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

/**
 * What tells a phone that a `numeric` code is digits (FUT-4144).
 *
 * The hook already refused letters, but nothing reached the `<input>` to say
 * so, and the courier's six-digit join code opened the letter keyboard.
 * `inputMode` picks the keypad; `pattern` is what iOS reads for the same; and
 * `one-time-code` on the FIRST slot lets the phone offer a code from an SMS —
 * the first slot, because it is the one that takes a paste and spreads it.
 * `alphanumeric` and `masked` are left exactly as they were.
 */
function keypadProps(variant: InputOTPProps['variant'], index: number): Record<string, string> {
  if (variant !== 'numeric') return {};
  return {
    inputMode: 'numeric',
    pattern: '[0-9]*',
    ...(index === 0 ? { autoComplete: 'one-time-code' } : {}),
  };
}

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
      // A group, so the `aria-label` a caller gives the code names the six
      // slots together: on a plain `div` it named nothing anyone could reach.
      role="group"
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
            ...keypadProps(variant, index),
          }}
        />
      ))}
    </Box>
  );
});

InputOTP.displayName = 'InputOTP';
