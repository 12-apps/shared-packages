import { Button as MuiButton, CircularProgress } from '@mui/material';
import { styled } from '@mui/material/styles';
import * as React from 'react';

import { resolveButtonProps } from './Button.helpers';
import {
  buttonEmphasisStyles,
  buttonVariantStyles,
  getColorFromTheme,
  iconAlignmentStyles,
  SIZE_MAP,
} from './Button.styles';
import type { ButtonProps } from './Button.types';

const StyledButton = styled(MuiButton, {
  shouldForwardProp: (prop) =>
    ['glow', 'pulse', 'loading', 'customVariant', 'customColor', 'ripple'].indexOf(
      prop as string,
    ) === -1,
})<{
  customVariant?: string;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  ripple?: boolean;
}>(({ theme, customVariant, customColor = 'primary', glow, pulse }) => {
  const colorPalette = getColorFromTheme(theme, customColor);

  return {
    textTransform: 'none',
    fontWeight: 500,
    borderRadius: theme.spacing(1),
    transition: 'all 0.3s ease',
    position: 'relative',
    overflow: 'hidden',
    ...iconAlignmentStyles(theme),
    ...buttonVariantStyles(theme, customVariant, colorPalette, customColor),
    ...buttonEmphasisStyles(colorPalette, glow, pulse),
  };
});

/** Our six variants collapse onto MUI's three; only outline and text differ. */
const muiVariantFor = (variant?: string): 'outlined' | 'text' | 'contained' => {
  if (variant === 'outline') return 'outlined';
  return variant === 'text' ? 'text' : 'contained';
};

type MuiButtonColor = 'inherit' | 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error';

/** `danger` and `neutral` are ours; the rest are MUI's own names already. */
const muiColorFor = (color: NonNullable<ButtonProps['color']>): MuiButtonColor => {
  if (color === 'danger') return 'error';
  return color === 'neutral' ? 'inherit' : color;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (rawProps, ref) => {
    const {
      variant,
      color,
      size,
      loading,
      icon,
      iconPosition,
      glow,
      pulse,
      ripple,
      active,
      children,
      disabled,
      onClick,
      onFocus,
      onBlur,
      dataTestId,
      ...props
    } = resolveButtonProps(rawProps);
    const testId = (suffix: string) =>
      dataTestId ? `${dataTestId}-${suffix}` : `button-${suffix}`;

    // Wrap icon with testId if provided
    const iconWithTestId =
      !loading && icon ? <span data-testid={testId('icon')}>{icon}</span> : undefined;

    const mergedClassName =
      [active ? 'active' : '', props.className].filter(Boolean).join(' ') || undefined;

    return (
      <StyledButton
        ref={ref}
        variant={muiVariantFor(variant)}
        color={muiColorFor(color)}
        customVariant={variant}
        customColor={color}
        glow={glow}
        pulse={pulse}
        ripple={ripple}
        disabled={disabled || loading}
        disableRipple={!ripple}
        startIcon={iconPosition === 'left' ? iconWithTestId : undefined}
        endIcon={iconPosition === 'right' ? iconWithTestId : undefined}
        onClick={onClick}
        onFocus={onFocus}
        onBlur={onBlur}
        sx={SIZE_MAP[size]}
        data-testid={dataTestId || 'button'}
        {...props}
        className={mergedClassName}
      >
        {loading ? (
          <CircularProgress size={16} color="inherit" data-testid={testId('loading')} />
        ) : (
          children
        )}
      </StyledButton>
    );
  },
);

Button.displayName = 'Button';
