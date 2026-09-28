import FormControl, { type FormControlProps } from '@mui/material/FormControl/index.js';
import { alpha, type CSSObject, keyframes, styled, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import {
  SELECT_BORDER,
  SELECT_GLASS,
  SELECT_GLOW,
  SELECT_GRADIENT,
  SELECT_PULSE,
  selectInputSize,
} from './Select.metrics';
import type { SelectProps } from './Select.types';

import { fieldEdge } from '../../../tokens/field-edge';
import { FIELD_BORDER_WIDTH, fieldControlStyles, fieldHeight } from '../../../tokens/field-height';
import type { SizeValue } from '../../../tokens/vocabulary';
import { fieldRadius } from '../../../tokens/field-radius';
import { absoluteInk } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

/**
 * THE FIELD CHROME BOTH WEB SELECTS WEAR — the menu `Select` and the searchable
 * one it becomes past {@link SEARCHABLE_MIN_OPTIONS} options. Shared so the two
 * cannot drift: a form whose short select and long select were drawn by two
 * copies of these rules would show it the first time one of them changed.
 */

// Define pulse animation
const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, SELECT_PULSE.spread)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

/** Glow ring on the outlined input, keyed off the `glow` prop. */
const glowStyles = (theme: Theme): CSSObject => ({
  '& .MuiOutlinedInput-root': {
    boxShadow: `0 0 ${rem(theme, SELECT_GLOW.rest.blur)} ${alpha(theme.palette.primary.main, SELECT_GLOW.rest.alpha)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 ${rem(theme, SELECT_GLOW.focused.blur)} ${alpha(theme.palette.primary.main, SELECT_GLOW.focused.alpha)}`,
    },
  },
});

/** Pulsing halo behind the control, keyed off the `pulse` prop. */
const pulseStyles = (theme: Theme, size: SizeValue): CSSObject => ({
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '0',
    right: '0',
    height: fieldHeight(theme, size),
    transform: 'translateY(-50%)',
    borderRadius: fieldRadius(theme),
    backgroundColor: theme.palette.primary.main,
    opacity: SELECT_PULSE.opacity,
    animation: `${pulseAnimation(theme)} ${SELECT_PULSE.ms / 1000}s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

/** `glass` variant: translucent, blurred background. */
const glassVariant = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.rest),
  backdropFilter: `blur(${rem(theme, SELECT_GLASS.blur)})`,
  // `SELECT_BORDER.rest` is the field hairline.
  border: `${FIELD_BORDER_WIDTH}px solid ${fieldEdge(theme)}`,
  '& fieldset': { border: 'none' },
  '&:hover': {
    backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.hover),
    borderColor: alpha(theme.palette.primary.main, SELECT_GLASS.hoverBorderAlpha),
  },
  '&.Mui-focused': {
    backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.focused),
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 ${rem(theme, SELECT_GLASS.focusRing.width)} ${alpha(theme.palette.primary.main, SELECT_GLASS.focusRing.alpha)}`,
  },
});

/** `gradient` variant: gradient fill with a masked gradient border. */
const gradientFill = (theme: Theme, strength: number): string =>
  `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${alpha(theme.palette.primary.main, strength)}, ${alpha(theme.palette.secondary.main, strength)})`;

const gradientVariant = (theme: Theme): CSSObject => ({
  background: gradientFill(theme, SELECT_GRADIENT.fill.rest),
  border: `${rem(theme, SELECT_GRADIENT.borderWidth)} solid transparent`,
  backgroundOrigin: 'border-box',
  backgroundClip: 'padding-box, border-box',
  position: 'relative',
  '& fieldset': { border: 'none' },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 'inherit',
    background: `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
    mask: `linear-gradient(${absoluteInk(theme).white} 0 0) content-box, linear-gradient(${absoluteInk(theme).white} 0 0)`,
    maskComposite: 'exclude',
    padding: rem(theme, SELECT_GRADIENT.borderWidth),
    zIndex: -1,
  },
  '&:hover': {
    background: gradientFill(theme, SELECT_GRADIENT.fill.hover),
  },
  '&.Mui-focused': {
    background: gradientFill(theme, SELECT_GRADIENT.fill.focused),
    '&::before': {
      background: `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
    },
  },
});

/** `default` variant: standard outlined borders with hover/focus/error states. */
const defaultVariant = (theme: Theme): CSSObject => ({
  '& fieldset': { borderColor: fieldEdge(theme) },
  '&:hover fieldset': { borderColor: theme.palette.primary.main },
  '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main, borderWidth: rem(theme, SELECT_BORDER.focused) },
  '&.Mui-error fieldset': { borderColor: theme.palette.error.main },
});

/** Pick the variant style block for the outlined input. */
const variantStyles = (theme: Theme, variant: SelectProps['variant']): CSSObject => {
  if (variant === 'glass') return glassVariant(theme);
  if (variant === 'gradient') return gradientVariant(theme);
  return defaultVariant(theme);
};

const StyledFormControl = styled(FormControl, {
  shouldForwardProp: (prop) =>
    prop !== 'customVariant' && prop !== 'fieldSize' && prop !== 'glow' && prop !== 'pulse',
})<{
  customVariant?: SelectProps['variant'];
  fieldSize: SizeValue;
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customVariant, fieldSize, glow, pulse }) => ({
  position: 'relative',
  // The theme's field height for this size — the height `Input` draws for it.
  ...fieldControlStyles(theme, fieldSize),
  ...(glow ? glowStyles(theme) : {}),
  ...(pulse ? pulseStyles(theme, fieldSize) : {}),
  '& .MuiOutlinedInput-root': {
    transition: 'all 0.3s ease',
    borderRadius: fieldRadius(theme),
    ...variantStyles(theme, customVariant),
  },
}));

/** What {@link SelectFieldControl} takes: a FormControl, plus the four look switches. */
export interface SelectFieldControlProps extends FormControlProps {
  customVariant?: SelectProps['variant'];
  fieldSize: SizeValue;
  glow?: boolean;
  pulse?: boolean;
  'data-testid'?: string;
}

/**
 * The styled FormControl, behind a component with a NAMED type: a `styled()`
 * export's inferred type reaches into `@mui/system`'s pnpm path, which the
 * declaration build refuses to write (TS2742).
 */
export const SelectFieldControl = React.forwardRef<HTMLDivElement, SelectFieldControlProps>(
  (props, ref) => <StyledFormControl ref={ref} {...props} />,
);

SelectFieldControl.displayName = 'SelectFieldControl';

/**
 * The house scale as a FormControl size.
 *
 * Not `muiSize`: that collapses five onto MUI's three, and a FormControl takes
 * only two. This component's scale is already narrowed to `sm | md`, so the map
 * is exact rather than lossy.
 */
export const formControlSize = (size: SelectProps['size']): 'small' | 'medium' | undefined => {
  if (size === undefined) return undefined;
  return selectInputSize(size) === 'sm' ? 'small' : 'medium';
};

