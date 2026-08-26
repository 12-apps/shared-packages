import { alpha, keyframes } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';

const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const SIZE_MAP = {
  sm: { fontSize: '0.75rem', padding: '4px 8px' },
  md: { fontSize: '0.875rem', padding: '6px 12px' },
  lg: { fontSize: '1rem', padding: '8px 16px' },
} as const;

export const getSizeStyles = (size?: string): { fontSize: string; padding: string } =>
  SIZE_MAP[size as keyof typeof SIZE_MAP] || SIZE_MAP.md;

export const variantStyles = (theme: Theme, variant?: string): CSSObject => {
  switch (variant) {
    case 'default':
      return {
        backgroundColor: alpha(theme.palette.grey[900], 0.92),
        color: theme.palette.common.white,
        boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.3)}`,
      };
    case 'dark':
      return {
        backgroundColor: '#000000',
        color: theme.palette.common.white,
        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.5)}`,
        border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
      };
    case 'light':
      return {
        backgroundColor: theme.palette.common.white,
        color: theme.palette.grey[900],
        border: `1px solid ${alpha(theme.palette.grey[400], 0.4)}`,
        boxShadow: `0 4px 16px ${alpha(theme.palette.common.black, 0.15)}`,
      };
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.75),
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
        color: theme.palette.text.primary,
        boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
export const emphasisStyles = (theme: Theme, glow?: boolean, pulse?: boolean): CSSObject => ({
  ...(glow && {
    boxShadow: `0 0 15px 3px ${alpha(theme.palette.primary.main, 0.4)} !important`,
    filter: 'brightness(1.05)',
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

export const arrowColor = (theme: Theme, variant?: string): string => {
  switch (variant) {
    case 'light':
      return theme.palette.common.white;
    case 'glass':
      return alpha(theme.palette.background.paper, 0.75);
    case 'dark':
      return '#000000';
    default:
      return alpha(theme.palette.grey[900], 0.92);
  }
};
