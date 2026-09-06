import MuiCheckbox from '@mui/material/Checkbox/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import FormControlLabel from '@mui/material/FormControlLabel/index.js';
import FormHelperText from '@mui/material/FormHelperText/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
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
import { px } from '../../../tokens/theme';

const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 ${effectInk(CHECKBOX_PULSE.alpha)};
  }
  70% {
    box-shadow: 0 0 0 ${CHECKBOX_PULSE.spread}px ${effectInk(0)};
  }
  100% {
    box-shadow: 0 0 0 0 ${effectInk(0)};
  }
`;

const glow = keyframes`
  0%, 100% {
    box-shadow: 0 0 ${CHECKBOX_GLOW.blur.from}px ${effectInk(CHECKBOX_GLOW.alpha.from)};
  }
  50% {
    box-shadow: 0 0 ${CHECKBOX_GLOW.blur.to}px ${effectInk(CHECKBOX_GLOW.alpha.to)};
  }
`;

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
        borderRadius: CHECKBOX_VARIANT.rounded.radius,
      },
    }),
    
    ...(customVariant === 'toggle' && {
      '& .MuiSvgIcon-root': {
        borderRadius: `${CHECKBOX_VARIANT.toggle.radius}px`,
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
        animation: `${glow} ${CHECKBOX_GLOW.ms / 1000}s ease-in-out infinite`,
      }),
      ...(pulseProp && {
        animation: `${pulse} ${CHECKBOX_PULSE.ms / 1000}s infinite`,
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
    marginLeft: CHECKBOX_LABEL.marginLeft,
    '& .MuiFormControlLabel-label': {
      color: error ? theme.palette.error.main : theme.palette.text.primary,
      fontSize: px(CHECKBOX_LABEL.fontSize),
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
            size={CHECKBOX_SPINNER.size}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              marginTop: `${CHECKBOX_SPINNER.offset}px`,
              marginLeft: `${CHECKBOX_SPINNER.offset}px`,
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