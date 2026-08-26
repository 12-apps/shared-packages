import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

const sizeStyles = (theme: Theme, size?: string): CSSObject => ({
    ...(size === 'sm' && {
      minHeight: 32,
      '& .MuiTab-root': {
        fontSize: '0.875rem',
        minHeight: 32,
        padding: theme.spacing(0.5, 1.5),
      },
    }),

    ...(size === 'lg' && {
      minHeight: 56,
      '& .MuiTab-root': {
        fontSize: '1.125rem',
        minHeight: 56,
        padding: theme.spacing(1.5, 3),
      },
    }),

});

const compactVariantStyles = (theme: Theme, customVariant?: string): CSSObject => ({
    ...(customVariant === 'default' && {
      '& .MuiTabs-indicator': {
        height: 3,
        borderRadius: '3px 3px 0 0',
        background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
      },
    }),

    // Pills variant (rounded tabs)
    ...(customVariant === 'pills' && {
      '& .MuiTabs-indicator': {
        display: 'none',
      },
      '& .MuiTab-root': {
        borderRadius: theme.spacing(3),
        margin: theme.spacing(0, 0.5),
        minWidth: 'auto',
        transition: 'all 0.3s ease',
        '&:hover': {
          backgroundColor: alpha(theme.palette.primary.main, 0.08),
          transform: 'translateY(-1px)',
        },
        '&.Mui-selected': {
          backgroundColor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
          '&:hover': {
            backgroundColor: theme.palette.primary.dark,
          },
        },
      },
    }),

    // Underline variant (minimal underline indicator)
});

const boxedVariantStyles = (theme: Theme, customVariant?: string): CSSObject => ({
    ...(customVariant === 'underline' && {
      '& .MuiTabs-flexContainer': {
        gap: theme.spacing(2),
      },
      '& .MuiTabs-indicator': {
        height: 2,
        backgroundColor: theme.palette.primary.main,
        borderRadius: 1,
      },
      '& .MuiTab-root': {
        textTransform: 'none',
        fontWeight: 500,
        padding: theme.spacing(1, 0),
        minWidth: 'auto',
        '&:hover': {
          color: theme.palette.primary.main,
        },
        '&.Mui-selected': {
          color: theme.palette.primary.main,
          fontWeight: 600,
        },
      },
    }),

    // Enclosed variant (bordered tabs)
    ...(customVariant === 'enclosed' && {
      '& .MuiTabs-indicator': {
        display: 'none',
      },
      '& .MuiTabs-flexContainer': {
        borderBottom: `1px solid ${theme.palette.divider}`,
      },
      '& .MuiTab-root': {
        border: `1px solid ${theme.palette.divider}`,
        borderBottom: 'none',
        borderRadius: `${theme.spacing(1)} ${theme.spacing(1)} 0 0`,
        margin: theme.spacing(0, 0.5),
        marginBottom: -1,
        backgroundColor: alpha(theme.palette.action.hover, 0.5),
        '&:hover': {
          backgroundColor: alpha(theme.palette.action.hover, 0.8),
        },
        '&.Mui-selected': {
          backgroundColor: theme.palette.background.paper,
          borderColor: theme.palette.divider,
          borderBottomColor: theme.palette.background.paper,
          zIndex: 1,
        },
      },
    }),
});

const variantStyles = (theme: Theme, customVariant?: string): CSSObject => ({
  ...compactVariantStyles(theme, customVariant),
  ...boxedVariantStyles(theme, customVariant),
});

// Vertical rules between tabs, for the variants that do not already have edges.
const dividerStyles = (
  theme: Theme,
  customVariant?: string,
  showDividers?: boolean,
): CSSObject => ({
  ...(showDividers &&
    customVariant !== 'enclosed' &&
    customVariant !== 'pills' && {
      '& .MuiTab-root:not(:last-child)': {
        borderRight: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
      },
    }),
});

// The root Tabs styling, kept out of Tabs.tsx so the styled() call stays small.
// Spread into a fresh literal at the call site: handing styled() a named-type
// value makes TypeScript demand a `variants` key (CSSObjectWithVariants).
export const tabsRootStyles = ({
  theme,
  customVariant,
  size,
  showDividers,
}: {
  theme: Theme;
  customVariant?: string;
  size?: string;
  showDividers?: boolean;
}): CSSObject => ({
    position: 'relative',

    // Collapse disabled scroll buttons (e.g. the left button at the start of a
    // scrollable row) so they don't reserve empty space before the first tab.
    '& .MuiTabs-scrollButtons.Mui-disabled': {
      width: 0,
      minWidth: 0,
      overflow: 'hidden',
    },

    // Size variants
  ...sizeStyles(theme, size),
  ...variantStyles(theme, customVariant),
  ...dividerStyles(theme, customVariant, showDividers),
});
