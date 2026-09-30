import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import {
  FILLED_WASH,
  FLOATING_LABEL,
  INPUT_BORDER,
  INPUT_GLASS,
  INPUT_GLOW,
  INPUT_GRADIENT,
  INPUT_PULSE,
} from './Input.metrics';
import type { InputProps } from './Input.types';

import { fieldEdge } from '../../../tokens/field-edge';
import { FIELD_BORDER_WIDTH, fieldHeight } from '../../../tokens/field-height';
import { fieldRadius } from '../../../tokens/field-radius';
import { absoluteInk } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';
import type { SizeValue } from '../../../tokens/vocabulary';

type InputVariant = NonNullable<InputProps['variant']>;

// The numbers below all come from `./Input.metrics`, which the native renderer
// reads too — see its header for why MUI's own values are in there as well.
export { muiVariantFor, SIZE_MAP } from './Input.metrics';

// The pulse ring, its spread through the theme's type scale.
const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, INPUT_PULSE.spread)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

export const glowStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputBase-root': {
    boxShadow: `0 0 ${rem(theme, INPUT_GLOW.rest.blur)} ${alpha(theme.palette.primary.main, INPUT_GLOW.rest.alpha)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 ${rem(theme, INPUT_GLOW.focused.blur)} ${alpha(theme.palette.primary.main, INPUT_GLOW.focused.alpha)}`,
    },
  },
});

// A bar behind the field rather than a border on it, so it can pulse outward
// without the input resizing.
export const pulseStyles = (theme: Theme, size: SizeValue = 'md'): CSSObject => ({
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
    opacity: INPUT_PULSE.opacity,
    animation: `${pulseAnimation(theme)} ${INPUT_PULSE.ms / 1000}s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

export const floatingLabelStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputLabel-root': {
    transform: `translate(${rem(theme, FLOATING_LABEL.rest.x)}, ${rem(theme, FLOATING_LABEL.rest.y)}) scale(1)`,
    '&.MuiInputLabel-shrink': {
      transform: `translate(${rem(theme, FLOATING_LABEL.shrink.x)}, ${rem(theme, FLOATING_LABEL.shrink.y)}) scale(${FLOATING_LABEL.scale})`,
      backgroundColor: theme.palette.background.paper,
      padding: `0 ${rem(theme, FLOATING_LABEL.paddingX)}`,
    },
  },
});

/**
 * The field's corner: the theme's one field radius (see `tokens/field-radius`).
 * `filled` rounds its top two only — its bottom edge is the underline — and
 * `underline` none, which is how MUI draws those two variants.
 */
export const inputRadiusStyles = (theme: Theme, variant?: InputVariant): CSSObject => {
  if (variant === 'underline') return {};
  const radius = fieldRadius(theme);
  if (variant === 'filled') return { borderTopLeftRadius: radius, borderTopRightRadius: radius };
  return { borderRadius: radius };
};

export const inputBaseStyles = (theme: Theme, variant?: InputVariant): CSSObject => {
  switch (variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.rest),
        backdropFilter: `blur(${rem(theme, INPUT_GLASS.blur)})`,
        border: `${FIELD_BORDER_WIDTH}px solid ${fieldEdge(theme)}`,
        '&:hover': {
          backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.hover),
          borderColor: alpha(theme.palette.primary.main, INPUT_GLASS.hoverBorderAlpha),
        },
        '&.Mui-focused': {
          backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.focused),
          borderColor: theme.palette.primary.main,
          boxShadow: `0 0 0 ${rem(theme, INPUT_GLASS.focusRing.width)} ${alpha(theme.palette.primary.main, INPUT_GLASS.focusRing.alpha)}`,
        },
      };
    case 'underline':
      return {
        '&:before': {
          borderBottomColor: fieldEdge(theme),
        },
        '&:hover:not(.Mui-disabled):before': {
          borderBottomColor: theme.palette.primary.main,
        },
        '&:after': {
          borderBottomColor: theme.palette.primary.main,
        },
      };
    case 'gradient':
      return gradientStyles(theme);
    default:
      return {};
  }
};

/** The 135° fill between the two brand hues, at one of its three strengths. */
const gradientFill = (theme: Theme, strength: number): string =>
  `linear-gradient(${INPUT_GRADIENT.angleDeg}deg, ${alpha(theme.palette.primary.main, strength)}, ${alpha(theme.palette.secondary.main, strength)})`;

// The border is a gradient painted behind the field and masked to a 2px ring,
// since CSS cannot put a gradient on `border-color` directly.
const gradientStyles = (theme: Theme): CSSObject => ({
  background: gradientFill(theme, INPUT_GRADIENT.fill.rest),
  border: `${rem(theme, INPUT_GRADIENT.borderWidth)} solid transparent`,
  backgroundOrigin: 'border-box',
  backgroundClip: 'padding-box, border-box',
  position: 'relative',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 'inherit',
    background: `linear-gradient(${INPUT_GRADIENT.angleDeg}deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
    mask: `linear-gradient(${absoluteInk(theme).white} 0 0) content-box, linear-gradient(${absoluteInk(theme).white} 0 0)`,
    maskComposite: 'exclude',
    padding: rem(theme, INPUT_GRADIENT.borderWidth),
    zIndex: -1,
  },
  '&:hover': {
    background: gradientFill(theme, INPUT_GRADIENT.fill.hover),
  },
  '&.Mui-focused': {
    background: gradientFill(theme, INPUT_GRADIENT.fill.focused),
    '&::before': {
      background: `linear-gradient(${INPUT_GRADIENT.angleDeg}deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
    },
  },
});

export const outlinedStyles = (theme: Theme): CSSObject => ({
  '& fieldset': {
    borderColor: fieldEdge(theme),
  },
  '&:hover fieldset': {
    borderColor: theme.palette.primary.main,
  },
  '&.Mui-focused fieldset': {
    borderColor: theme.palette.primary.main,
    borderWidth: rem(theme, INPUT_BORDER.focused),
  },
  '&.Mui-error fieldset': {
    borderColor: theme.palette.error.main,
  },
});

export const filledStyles = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.action.hover, FILLED_WASH.rest),
  '&:hover': {
    backgroundColor: alpha(theme.palette.action.hover, FILLED_WASH.hover),
  },
  '&.Mui-focused': {
    backgroundColor: alpha(theme.palette.action.hover, FILLED_WASH.focused),
  },
});
