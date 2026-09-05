import MuiButton from '@mui/material/Button/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { styled } from '@mui/material/styles/index.js';
import * as React from 'react';

import { resolveButtonProps } from './Button.helpers';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import {
  buttonEmphasisStyles,
  buttonVariantStyles,
  getColorFromTheme,
  iconAlignmentStyles,
  buttonSize,
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

/**
 * An icon and nothing else — the shape that should render square.
 *
 * A separate predicate rather than three clauses inline: the component function
 * is already at the complexity ceiling, and "what counts as an icon button" is
 * a rule worth naming anyway. `loading` disqualifies, because a spinner
 * replaces the children and would otherwise make every loading button square.
 */
function isIconOnly({
  loading,
  icon,
  children,
}: Pick<ButtonProps, 'loading' | 'icon' | 'children'>): boolean {
  return !loading && icon != null && children == null;
}

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
      ...others
    } = resolveButtonProps(rawProps);
    // Every spelling of the test id the shared contract allows, mapped to the
    // one the DOM reads; the native Button does the same in reverse.
    const ownTestId = resolveTestId(others, 'button');
    const testId = (suffix: string) => childTestId(others, suffix, 'button');
    const props = withoutTestIdProps(others);

    // Wrap icon with testId if provided
    const iconWithTestId =
      !loading && icon ? <span data-testid={testId('icon')}>{icon}</span> : undefined;

    // Only an icon, so the button is a square rather than a 64px slab.
    const iconOnly = isIconOnly({ loading, icon, children });

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
        sx={buttonSize(size, iconOnly)}
        data-testid={ownTestId}
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
