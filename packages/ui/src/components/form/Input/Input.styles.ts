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

type InputVariant = NonNullable<InputProps['variant']>;

// The numbers below all come from `./Input.metrics`, which the native renderer
// reads too — see its header for why MUI's own values are in there as well.
export { muiVariantFor, SIZE_MAP } from './Input.metrics';

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${INPUT_PULSE.spread}px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

export const glowStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputBase-root': {
    boxShadow: `0 0 ${INPUT_GLOW.rest.blur}px ${alpha(theme.palette.primary.main, INPUT_GLOW.rest.alpha)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 ${INPUT_GLOW.focused.blur}px ${alpha(theme.palette.primary.main, INPUT_GLOW.focused.alpha)}`,
    },
  },
});

// A bar behind the field rather than a border on it, so it can pulse outward
// without the input resizing.
export const pulseStyles = (theme: Theme): CSSObject => ({
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '0',
    right: '0',
    height: `${INPUT_PULSE.height}px`,
    transform: 'translateY(-50%)',
    borderRadius: theme.spacing(INPUT_PULSE.radiusUnits),
    backgroundColor: theme.palette.primary.main,
    opacity: INPUT_PULSE.opacity,
    animation: `${pulseAnimation} ${INPUT_PULSE.ms / 1000}s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

export const floatingLabelStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputLabel-root': {
    transform: `translate(${FLOATING_LABEL.rest.x}px, ${FLOATING_LABEL.rest.y}px) scale(1)`,
    '&.MuiInputLabel-shrink': {
      transform: `translate(${FLOATING_LABEL.shrink.x}px, ${FLOATING_LABEL.shrink.y}px) scale(${FLOATING_LABEL.scale})`,
      backgroundColor: theme.palette.background.paper,
      padding: `0 ${FLOATING_LABEL.paddingX}px`,
    },
  },
});

export const inputBaseStyles = (theme: Theme, variant?: InputVariant): CSSObject => {
  switch (variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.rest),
        backdropFilter: `blur(${INPUT_GLASS.blur}px)`,
        border: `${INPUT_BORDER.rest}px solid ${fieldEdge(theme)}`,
        '&:hover': {
          backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.hover),
          borderColor: alpha(theme.palette.primary.main, INPUT_GLASS.hoverBorderAlpha),
        },
        '&.Mui-focused': {
          backgroundColor: alpha(theme.palette.background.paper, INPUT_GLASS.background.focused),
          borderColor: theme.palette.primary.main,
          boxShadow: `0 0 0 ${INPUT_GLASS.focusRing.width}px ${alpha(theme.palette.primary.main, INPUT_GLASS.focusRing.alpha)}`,
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
  border: `${INPUT_GRADIENT.borderWidth}px solid transparent`,
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
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    padding: `${INPUT_GRADIENT.borderWidth}px`,
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
    borderWidth: INPUT_BORDER.focused,
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
