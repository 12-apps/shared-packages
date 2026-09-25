import MuiCheckbox from '@mui/material/Checkbox/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import FormControlLabel from '@mui/material/FormControlLabel/index.js';
import FormHelperText from '@mui/material/FormHelperText/index.js';
import { alpha, keyframes, styled, useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { makeTestId, resolveCheckboxProps } from './Checkbox.helpers';
import {
  CHECKBOX_GLOW,
  CHECKBOX_HELPER,
  CHECKBOX_HOVER_ALPHA,
  CHECKBOX_LABEL,
  CHECKBOX_PULSE,
  CHECKBOX_SPINNER,
  CHECKBOX_TRANSITION_MS,
  CHECKBOX_VARIANT,
  effectInk,
} from './Checkbox.metrics';
import type { CheckboxProps } from './Checkbox.types';
import { splitTestId } from '../../../platform/test-id';
import { rem, sxRem } from '../../../tokens/relative';

const pulse = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 ${effectInk(CHECKBOX_PULSE.alpha)};
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, CHECKBOX_PULSE.spread)} ${effectInk(0)};
  }
  100% {
    box-shadow: 0 0 0 0 ${effectInk(0)};
  }
`;

const glow = (theme: Theme) => keyframes`
  0%, 100% {
    box-shadow: 0 0 ${rem(theme, CHECKBOX_GLOW.blur.from)} ${effectInk(CHECKBOX_GLOW.alpha.from)};
  }
  50% {
    box-shadow: 0 0 ${rem(theme, CHECKBOX_GLOW.blur.to)} ${effectInk(CHECKBOX_GLOW.alpha.to)};
  }
`;

/** A variant's corner: a design-px number through the type scale, a percentage as it is. */
const cornerOf = (theme: Theme, radius: number | string | undefined): string | undefined =>
  typeof radius === 'number' ? rem(theme, radius) : radius;

const StyledCheckbox = styled(MuiCheckbox, {
  shouldForwardProp: (prop) => !['customVariant', 'ripple', 'glow', 'pulse'].includes(prop as string),
})<{ 
  customVariant?: CheckboxProps['variant'];
  ripple?: boolean;
  glow?: boolean;
  pulse?: boolean;
}>(
  ({ theme, customVariant, ripple, glow: glowProp, pulse: pulseProp }) => ({
    ...(customVariant === 'rounded' && {
      '& .MuiSvgIcon-root': {
        borderRadius: cornerOf(theme, CHECKBOX_VARIANT.rounded.radius),
      },
    }),
    
    ...(customVariant === 'toggle' && {
      '& .MuiSvgIcon-root': {
        borderRadius: cornerOf(theme, CHECKBOX_VARIANT.toggle.radius),
        transform: `scale(${CHECKBOX_VARIANT.toggle.scale})`,
      },
    }),
    
    '&.MuiCheckbox-root': {
      transition: `all ${CHECKBOX_TRANSITION_MS / 1000}s ease`,
      ...(ripple === false && {
        '& .MuiTouchRipple-root': {
          display: 'none',
        },
      }),
      ...(glowProp && {
        animation: `${glow(theme)} ${CHECKBOX_GLOW.ms / 1000}s ease-in-out infinite`,
      }),
      ...(pulseProp && {
        animation: `${pulse(theme)} ${CHECKBOX_PULSE.ms / 1000}s infinite`,
      }),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, CHECKBOX_HOVER_ALPHA),
      },
    },
    
    '&.Mui-checked': {
      color: theme.palette.primary.main,
    },
    
    '&.MuiCheckbox-indeterminate': {
      color: theme.palette.primary.main,
    },
  })
);

const StyledFormControlLabel = styled(FormControlLabel, {
  shouldForwardProp: (prop) => prop !== 'error',
})<{ error?: boolean }>(
  ({ theme, error }) => ({
    marginLeft: rem(theme, CHECKBOX_LABEL.marginLeft),
    '& .MuiFormControlLabel-label': {
      color: error ? theme.palette.error.main : theme.palette.text.primary,
      fontSize: rem(theme, CHECKBOX_LABEL.fontSize),
    },
  })
);

const StyledFormHelperText = styled(FormHelperText)(({ theme }) => ({
  marginLeft: theme.spacing(CHECKBOX_HELPER.marginLeftUnits),
  marginTop: theme.spacing(CHECKBOX_HELPER.marginTopUnits),
}));

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (rawProps, ref) => {
    const {
      variant,
      label,
      error,
      helperText,
      loading,
      ripple,
      glow,
      pulse,
      disabled,
      ...others
    } = resolveCheckboxProps(rawProps);
    const theme = useTheme();
    const isDisabled = disabled || loading;
    const { testId: dataTestId, rest: props } = splitTestId(others);
    const testId = makeTestId(dataTestId);

    const checkbox = (
      <div style={{ position: 'relative', display: 'inline-flex' }}>
        <StyledCheckbox
          ref={ref}
          customVariant={variant}
          ripple={ripple}
          glow={glow}
          pulse={pulse}
          disabled={isDisabled}
          data-testid={dataTestId || 'checkbox'}
          {...props}
        />
        {loading && (
          <CircularProgress
            size={rem(theme, CHECKBOX_SPINNER.size)}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              marginTop: sxRem(CHECKBOX_SPINNER.offset),
              marginLeft: sxRem(CHECKBOX_SPINNER.offset),
              color: 'primary.main',
            }}
          />
        )}
      </div>
    );
    
    if (label) {
      return (
        <div data-testid={testId('container')}>
          <StyledFormControlLabel
            control={checkbox}
            label={label}
            error={error}
            disabled={isDisabled}
          />
          {helperText && (
            <StyledFormHelperText 
              error={error}
              data-testid={testId('helper')}
            >
              {helperText}
            </StyledFormHelperText>
          )}
        </div>
      );
    }
    
    return checkbox;
  }
);

Checkbox.displayName = 'Checkbox';