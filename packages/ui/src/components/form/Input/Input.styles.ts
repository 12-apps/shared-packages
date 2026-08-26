import { alpha, keyframes } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';

import type { InputProps } from './Input.types';

type InputVariant = NonNullable<InputProps['variant']>;

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 10px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

/** Our four variants map onto MUI's three; `glass` and `gradient` restyle an outline. */
export const muiVariantFor = (variant: InputVariant): 'outlined' | 'filled' | 'standard' => {
  switch (variant) {
    case 'underline':
      return 'standard';
    case 'glass':
    case 'gradient':
      return 'outlined';
    default:
      return variant as 'outlined' | 'filled' | 'standard';
  }
};

// MUI gives a text field two heights, so the five house stops are drawn as two
// plus padding: `xs` tightens below small, `lg`/`xl` open up above medium.
export const SIZE_MAP = {
  xs: { size: 'small' as const, sx: { '& .MuiInputBase-input': { padding: '6px 10px' } } },
  sm: { size: 'small' as const },
  md: { size: 'medium' as const },
  lg: { size: 'medium' as const, sx: { '& .MuiInputBase-input': { padding: '16px 14px' } } },
  xl: { size: 'medium' as const, sx: { '& .MuiInputBase-input': { padding: '20px 16px' } } },
};

export const glowStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputBase-root': {
    boxShadow: `0 0 15px ${alpha(theme.palette.primary.main, 0.3)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.5)}`,
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
    height: '56px',
    transform: 'translateY(-50%)',
    borderRadius: theme.spacing(0.5),
    backgroundColor: theme.palette.primary.main,
    opacity: 0.3,
    animation: `${pulseAnimation} 2s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

export const floatingLabelStyles = (theme: Theme): CSSObject => ({
  '& .MuiInputLabel-root': {
    transform: 'translate(14px, 16px) scale(1)',
    '&.MuiInputLabel-shrink': {
      transform: 'translate(14px, -9px) scale(0.75)',
      backgroundColor: theme.palette.background.paper,
      padding: '0 4px',
    },
  },
});

export const inputBaseStyles = (theme: Theme, variant?: InputVariant): CSSObject => {
  switch (variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        '&:hover': {
          backgroundColor: alpha(theme.palette.background.paper, 0.15),
          borderColor: alpha(theme.palette.primary.main, 0.3),
        },
        '&.Mui-focused': {
          backgroundColor: alpha(theme.palette.background.paper, 0.2),
          borderColor: theme.palette.primary.main,
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.1)}`,
        },
      };
    case 'underline':
      return {
        '&:before': {
          borderBottomColor: alpha(theme.palette.divider, 0.42),
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

// The border is a gradient painted behind the field and masked to a 2px ring,
// since CSS cannot put a gradient on `border-color` directly.
const gradientStyles = (theme: Theme): CSSObject => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
  border: `2px solid transparent`,
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
    background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    padding: '2px',
    zIndex: -1,
  },
  '&:hover': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.15)})`,
  },
  '&.Mui-focused': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, ${alpha(theme.palette.secondary.main, 0.2)})`,
    '&::before': {
      background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
    },
  },
});

export const outlinedStyles = (theme: Theme): CSSObject => ({
  '& fieldset': {
    borderColor: alpha(theme.palette.divider, 0.23),
  },
  '&:hover fieldset': {
    borderColor: theme.palette.primary.main,
  },
  '&.Mui-focused fieldset': {
    borderColor: theme.palette.primary.main,
    borderWidth: 2,
  },
  '&.Mui-error fieldset': {
    borderColor: theme.palette.error.main,
  },
});

export const filledStyles = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.action.hover, 0.04),
  '&:hover': {
    backgroundColor: alpha(theme.palette.action.hover, 0.08),
  },
  '&.Mui-focused': {
    backgroundColor: alpha(theme.palette.action.hover, 0.12),
  },
});
