import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

export const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const pulseGlow = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(25, 118, 210, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0);
  }
`;

const SIZE_STYLES: Record<string, (theme: Theme) => CSSObject> = {
  sm: (theme) => ({
    padding: theme.spacing(1, 1.5),
    fontSize: '0.875rem',
    '& .MuiListItemIcon-root': { transform: 'scale(0.85)' },
  }),
  lg: (theme) => ({
    padding: theme.spacing(2, 2.5),
    fontSize: '1.125rem',
    '& .MuiListItemIcon-root': { transform: 'scale(1.15)' },
  }),
};

// Each of these applies independently of the others, so they layer rather than
// forming a lookup.
const horizontalStyles = (theme: Theme): CSSObject => ({
      borderRadius: theme.spacing(1.5),
      margin: theme.spacing(0, 0.5),
      background: alpha(theme.palette.background.paper, 0.6),
      backdropFilter: 'blur(8px)',
      border: `none`,
      // border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    });

const collapsedStyles = (): CSSObject => ({
      justifyContent: 'center',
      minHeight: 56,
      '& .MuiListItemIcon-root': {
        margin: 0,
      },
    });

const activeStyles = (theme: Theme, _variant?: string): CSSObject => ({
      color: theme.palette.primary.main,
      cursor: 'default',

      '& .MuiListItemIcon-root': {
        color: theme.palette.primary.main,
      },

      '&::before': {
        opacity: 1,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
      },

      '&:hover': {
        background: 'none',
        transform: 'none',
        boxShadow: 'none',

        '&::before': {
          opacity: 1,
        },

        '& .MuiListItemIcon-root': {
          transform: 'none',
        },

        '& .MuiListItemText-primary': {
          transform: 'none',
        },
      },
    });

// Decorative sweep and glow layers behind the row.
const navDecorationStyles = (theme: Theme): CSSObject => ({
  '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 100%)`,
      opacity: 0,
      transition: 'opacity 0.3s ease',
    },
  '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '100%',
      height: '100%',
      background: `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.3)} 0%, transparent 70%)`,
      transform: 'translate(-50%, -50%) scale(0)',
      transition: 'transform 0.6s ease',
      borderRadius: '50%',
    },
});

// The minimal variant deliberately skips the lift-and-glow treatment.
const navInteractionStyles = (
  theme: Theme,
  minimal?: boolean,
  collapsed?: boolean,
  size?: string,
): CSSObject => ({
  '&:hover': minimal
      ? {
          // Simple hover for minimal variant
          backgroundColor: alpha(theme.palette.action.hover, 0.08),
          color: theme.palette.primary.main,

          '& .MuiListItemIcon-root': {
            color: theme.palette.primary.main,
          },
        }
      : {
          // Fancy hover for non-minimal variant
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 100%)`,
          color: theme.palette.primary.main,
          boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.15)}`,
          backgroundColor: alpha(theme.palette.primary.main, 0.04),

          '&::before': {
            opacity: 1,
          },

          '& .MuiListItemIcon-root': {
            color: theme.palette.primary.main,
            transform: collapsed
              ? 'scale(1.1)'
              : size === 'sm'
                ? 'scale(0.95) rotate(-5deg)'
                : size === 'lg'
                  ? 'scale(1.25) rotate(-5deg)'
                  : 'scale(1.1) rotate(-5deg)',
            transition: 'all 0.3s ease',
          },

          '& .MuiListItemText-primary': {
            transform: 'translateX(4px)',
            transition: 'transform 0.3s ease',
          },
        },
  '&:active': minimal
      ? {
          // Simple active state for minimal variant
          opacity: 0.7,
        }
      : {
          // Fancy active state for non-minimal variant
          transform: 'scale(0.98)',
          '&::after': {
            transform: 'translate(-50%, -50%) scale(2)',
          },
        },
});

// The nav row's own styling: base layout plus the variant, size, collapsed and
// minimal treatments. Lifted out so the styled() callback is a single spread.
export const navItemButtonStyles = ({
  theme,
  variant,
  active,
  size,
  collapsed,
  minimal,
}: {
  theme: Theme;
  variant?: string;
  active?: boolean;
  size?: string;
  collapsed?: boolean;
  minimal?: boolean;
}): CSSObject => ({
  ...(size ? (SIZE_STYLES[size]?.(theme) ?? {}) : {}),
  ...(variant === 'horizontal' ? horizontalStyles(theme) : {}),
  ...(collapsed ? collapsedStyles() : {}),
  ...(active ? activeStyles(theme, variant) : {}),
  ...navDecorationStyles(theme),
  ...navInteractionStyles(theme, minimal, collapsed, size),
    borderRadius: theme.spacing(1.5),
    margin: theme.spacing(0.5),
    position: 'relative',
    overflow: 'hidden',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    transformStyle: 'preserve-3d',

















  });
