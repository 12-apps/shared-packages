import MuiButton from '@mui/material/Button/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { styled } from '@mui/material/styles/index.js';
import * as React from 'react';

import { resolveButtonProps } from './Button.helpers';
import { BUTTON_ICON_GLYPH_SIZE } from './Button.metrics';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import {
  buttonEmphasisStyles,
  buttonVariantStyles,
  getColorFromTheme,
  iconAlignmentStyles,
  buttonSize,
} from './Button.styles';
import type { ButtonComponent, ButtonProps } from './Button.types';

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

/**
 * Our five sizes collapse onto MUI's three, so the rendered class NAMES the
 * size the button actually is (12-74).
 *
 * It was never forwarded, so every button — `xs` through `xl` — carried
 * `MuiButton-sizeMedium`. The pixels were right (they come from `buttonSize`'s
 * `sx`, which still decides them) but the DOM said "medium" about a large
 * button: a test could never assert the size, and devtools lied to whoever
 * opened them.
 *
 * MUI's own size styles are padding, font-size and the icon glyph. The first
 * two are overridden by that same `sx`; the third is pinned by
 * `BUTTON_ICON_GLYPH_SIZE`, so forwarding this moves nothing on screen.
 */
const muiSizeFor = (size: NonNullable<ButtonProps['size']>): 'small' | 'medium' | 'large' => {
  if (size === 'xs' || size === 'sm') return 'small';
  return size === 'md' ? 'medium' : 'large';
};

/** `danger` and `neutral` are ours; the rest are MUI's own names already. */
const muiColorFor = (color: NonNullable<ButtonProps['color']>): MuiButtonColor => {
  if (color === 'danger') return 'error';
  return color === 'neutral' ? 'inherit' : color;
};

/**
 * The icon slot's font-size, pinned on the wrapper this component already owns
 * (12-74).
 *
 * MUI writes 18/20/22 there off its own `size`, and that prop is now forwarded,
 * so a glyph that takes its size by INHERITANCE would start moving with the
 * button — measured at 18px on `xs` and 22px on `lg` against the 20px every
 * size has always drawn. See {@link BUTTON_ICON_GLYPH_SIZE} for what that does
 * and does not reach.
 *
 * Written as an inline style rather than a selector in `sx` because MUI's own
 * rule sits on the start/end-icon span itself. Beating it from the root means
 * winning a specificity contest at a distance — true in a browser, but not
 * something a test can hold, since jsdom resolves `getComputedStyle` by
 * document order and never by specificity. Inline wins both, and it sits on the
 * one element we already render for this glyph.
 *
 * A number, not `px()`: React writes `font-size: 20px`, which is exactly the
 * declaration MUI was emitting before.
 */
const ICON_GLYPH_STYLE = { fontSize: BUTTON_ICON_GLYPH_SIZE } as const;

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

/**
 * The design system's button.
 *
 * Typed as an `OverridableComponent` (12-70) rather than a plain `forwardRef`,
 * which is how MUI models a component that can render as something else. The
 * practical difference is one line at a call site:
 *
 * ```tsx
 * <Button component={Link} to="/account/compras/42">Acompanhar pedido</Button>
 * ```
 *
 * `to` is typed here because the generic carries the target component's own
 * props through. A plain `component?: React.ElementType` — what this was —
 * accepts the component and throws its props away, so `to` typechecked
 * nowhere even though it arrived intact at runtime. A host wanting a router
 * navigation painted as a button had to choose between a type assertion and
 * losing the `href`; both were shipped, and both are the reason this ticket
 * exists.
 */
const ButtonRoot = React.forwardRef<HTMLButtonElement, ButtonProps>(
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
      !loading && icon ? (
        <span data-testid={testId('icon')} style={ICON_GLYPH_STYLE}>
          {icon}
        </span>
      ) : undefined;

    // Only an icon, so the button is a square rather than a 64px slab.
    const iconOnly = isIconOnly({ loading, icon, children });

    const mergedClassName =
      [active ? 'active' : '', props.className].filter(Boolean).join(' ') || undefined;

    return (
      <StyledButton
        ref={ref}
        variant={muiVariantFor(variant)}
        color={muiColorFor(color)}
        size={muiSizeFor(size)}
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

ButtonRoot.displayName = 'Button';

/**
 * The cast is what publishes the generic — `forwardRef` cannot express
 * "renders as C, and takes C's props" on its own, so MUI's own components do
 * exactly this. `ButtonRoot` above is the implementation and is not exported.
 */
export const Button = ButtonRoot as ButtonComponent;
