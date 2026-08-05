import { 
  alpha,
  Checkbox as MuiCheckbox, 
  CircularProgress,
  FormControlLabel, 
  FormHelperText,
  keyframes,
  styled} from '@mui/material';
import React from 'react';

import { makeTestId, resolveCheckboxProps } from './Checkbox.helpers';
import type { CheckboxProps } from './Checkbox.types';

const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(25, 118, 210, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0);
  }
`;

const glow = keyframes`
  0%, 100% {
    box-shadow: 0 0 5px rgba(25, 118, 210, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(25, 118, 210, 0.8);
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
        borderRadius: '50%',
      },
    }),
    
    ...(customVariant === 'toggle' && {
      '& .MuiSvgIcon-root': {
        borderRadius: '12px',
        transform: 'scale(1.2)',
      },
    }),
    
    '&.MuiCheckbox-root': {
      transition: 'all 0.3s ease',
      ...(ripple === false && {
        '& .MuiTouchRipple-root': {
          display: 'none',
        },
      }),
      ...(glowProp && {
        animation: `${glow} 2s ease-in-out infinite`,
      }),
      ...(pulseProp && {
        animation: `${pulse} 2s infinite`,
      }),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.1),
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
    marginLeft: 0,
    '& .MuiFormControlLabel-label': {
      color: error ? theme.palette.error.main : theme.palette.text.primary,
      fontSize: '0.875rem',
    },
  })
);

const StyledFormHelperText = styled(FormHelperText)(({ theme }) => ({
  marginLeft: theme.spacing(4),
  marginTop: theme.spacing(0.5),
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
      'data-testid': dataTestId,
      ...props
    } = resolveCheckboxProps(rawProps);
    const isDisabled = disabled || loading;
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
            size={20}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              marginTop: '-10px',
              marginLeft: '-10px',
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