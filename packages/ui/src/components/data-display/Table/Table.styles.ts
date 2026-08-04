import { alpha, keyframes } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

import type { TableDensity, TableStripeColor } from './Table.types';

export const pulseAnimation = keyframes`
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

// Density configurations
export const getDensityConfig = (density: TableDensity = 'normal') => {
  const configs = {
    compact: {
      rowHeight: 36,
      cellPadding: '6px 12px',
      fontSize: '0.8125rem',
      headerPadding: '8px 12px',
    },
    normal: {
      rowHeight: 52,
      cellPadding: '12px 16px',
      fontSize: '0.875rem',
      headerPadding: '16px 16px',
    },
    comfortable: {
      rowHeight: 68,
      cellPadding: '18px 24px',
      fontSize: '0.875rem',
      headerPadding: '20px 24px',
    },
  };
  return configs[density];
};

export const getStripeColorFromTheme = (theme: { palette: { primary: { main: string }; secondary: { main: string }; info: { main: string }; success: { main: string }; warning: { main: string }; error: { main: string }; action: { hover: string } } }, stripeColor: TableStripeColor = 'neutral') => {
  const colorMap: Record<TableStripeColor, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    info: theme.palette.info.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    neutral: theme.palette.action.hover,
  };
  return colorMap[stripeColor];
};

// One variant applies at a time, so a lookup replaces the mutually exclusive
// spreads.
const TABLE_VARIANTS: Record<string, (args: VariantArgs) => CSSObject> = {
  default: ({ theme, densityConfig, stripeColor }) => ({
      backgroundColor: theme.palette.background.paper,
      '& .MuiTableHead-root': {
        backgroundColor: alpha(theme.palette.primary.main, 0.1),
      },
    }),
  striped: ({ theme, densityConfig, stripeColor }) => ({
      backgroundColor: theme.palette.background.paper,
      '& .MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
        backgroundColor: alpha(getStripeColorFromTheme(theme, stripeColor), stripeColor === 'neutral' ? 0.5 : 0.15),
      },
    }),
  glass: ({ theme, densityConfig, stripeColor }) => ({
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),
  minimal: ({ theme, densityConfig, stripeColor }) => ({
      backgroundColor: 'transparent',
      '& .MuiTableCell-root': {
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      },
    }),
  gradient: ({ theme, densityConfig, stripeColor }) => ({
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.secondary.main, 0.05)})`,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      '& .MuiTableHead-root': {
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.15)})`,
      },
      '& .MuiTableCell-root': {
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
      },
    }),
};

type VariantArgs = {
  theme: Theme;
  densityConfig: ReturnType<typeof getDensityConfig>;
  stripeColor?: TableStripeColor;
};

const tableVariantStyles = (args: VariantArgs, customVariant?: string): CSSObject =>
  customVariant ? (TABLE_VARIANTS[customVariant]?.(args) ?? {}) : {};

// The table's own styling, lifted out so the styled() callback just forwards
// its props.
export const tableStyles = ({
  theme,
  customVariant,
  glow,
  pulse,
  hoverable,
  density,
  stickyHeader,
  stripeColor = 'neutral',
}: {
  theme: Theme;
  customVariant?: string;
  glow?: boolean;
  pulse?: boolean;
  hoverable?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  stripeColor?: TableStripeColor;
}): CSSObject => {
  const densityConfig = getDensityConfig(density);
  
  return {
    borderRadius: theme.spacing(1),
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    position: 'relative',

    // Density styles
    '& .MuiTableCell-root': {
      padding: densityConfig.cellPadding,
      fontSize: densityConfig.fontSize,
      height: densityConfig.rowHeight,
    },

    // Sticky header
    ...tableVariantStyles({ theme, densityConfig, stripeColor }, customVariant),
    ...(stickyHeader && {
      '& .MuiTableHead-root': {
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: theme.palette.background.paper,
        '& .MuiTableCell-root': {
          borderBottom: `2px solid ${theme.palette.divider}`,
          fontWeight: 600,
          padding: densityConfig.headerPadding,
        },
      },
    }),

    // Variant styles










    // Hoverable rows
    ...(hoverable && {
      '& .MuiTableBody-root .MuiTableRow-root:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        cursor: 'pointer',
        transition: 'background-color 0.15s ease-in-out',
      },
    }),

    // Selection styles
    '& .MuiTableRow-root.selected': {
      backgroundColor: alpha(theme.palette.primary.main, 0.12),
      '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.16),
      },
    },

    // Glow effect
    ...(glow && !pulse && {
      boxShadow: `0 0 20px 5px ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)',
    }),

    // Pulse animation
    ...(pulse && !glow && {
      position: 'relative',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1,
      },
    }),

    // Both glow and pulse
    ...(glow && pulse && {
      position: 'relative',
      boxShadow: `0 0 20px 5px ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1,
      },
    }),
  };
}
