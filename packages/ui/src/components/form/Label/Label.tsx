import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import React, { forwardRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { LabelBody } from './Label.parts';
import { labelStyles, sizeStyles, SR_ONLY_SX, textColor } from './Label.styles';
import type { LabelStyleFlags } from './Label.styles';
import type { LabelProps } from './Label.types';

const DEFAULTS = {
  required: false,
  disabled: false,
  error: false,
  variant: 'default',
  size: 'md',
  color: 'neutral',
  glow: false,
  pulse: false,
  ripple: false,
  loading: false,
  asteriskPlacement: 'end',
  iconPosition: 'start',
  srOnly: false,
  weight: 'regular',
  transform: 'none',
  align: 'left',
  nowrap: false,
  truncate: false,
} satisfies Partial<LabelProps>;

type ResolvedProps = LabelProps & Required<Pick<LabelProps, keyof typeof DEFAULTS>>;

export const Label = forwardRef<globalThis.HTMLLabelElement, LabelProps>((props, ref) => {
  const {
    children, htmlFor, required, disabled, error, variant, size, color,
    glow, pulse, ripple, loading, className, style, tooltip, helperText,
    asteriskPlacement, icon, iconPosition, onClick, onFocus, onBlur,
    srOnly, weight, transform, align, nowrap, truncate, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const theme = useTheme();

  const flags: LabelStyleFlags = {
    variant, size, color, weight, transform, align,
    error, disabled, glow, pulse, ripple, srOnly, nowrap, truncate,
    clickable: Boolean(onClick),
  };

  const labelContent = (
    <Box
      component="label"
      ref={ref}
      htmlFor={htmlFor}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      className={className}
      data-testid={dataTestId}
      sx={{ ...labelStyles(theme, flags), ...style }}
      {...rest}
    >
      <LabelBody
        required={required}
        asteriskPlacement={asteriskPlacement}
        icon={icon}
        iconPosition={iconPosition}
        loading={loading}
        fontSize={sizeStyles(theme, size).fontSize as string}
        color={textColor(theme, flags)}
      >
        {children}
      </LabelBody>
    </Box>
  );

  // A screen-reader-only label is rendered on its own: the tooltip, the styling
  // and the helper text all describe something nothing can see.
  if (srOnly) {
    return (
      <Box component="label" htmlFor={htmlFor} data-testid={dataTestId} sx={SR_ONLY_SX}>
        {children}
      </Box>
    );
  }

  return (
    <>
      {tooltip ? (
        <Tooltip title={tooltip} arrow>
          {labelContent}
        </Tooltip>
      ) : (
        labelContent
      )}

      {helperText && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: error ? theme.palette.error.main : theme.palette.text.secondary,
            marginTop: theme.spacing(0.5),
            fontSize: '0.75rem',
          }}
        >
          {helperText}
        </Typography>
      )}
    </>
  );
});

Label.displayName = 'Label';
