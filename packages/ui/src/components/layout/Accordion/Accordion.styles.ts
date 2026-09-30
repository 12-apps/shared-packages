import { alpha } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';

import { rem, rems } from '../../../tokens/relative';

import type { AccordionVariant } from './Accordion.types';

const BASE_TRANSITION = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

// Deliberately unannotated: the inferred union of literals assigns to MUI's
// `sx`, whereas a `CSSObject` return type does not survive being spread into it.
export const accordionVariantStyles = (theme: Theme, variant: AccordionVariant) => {
  switch (variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.08),
        backdropFilter: `blur(${rem(theme, 24)}) saturate(180%)`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
        borderRadius: theme.spacing(1.5),
        transition: BASE_TRANSITION,
        '&:before': {
          display: 'none',
        },
        '&:hover': {
          backgroundColor: alpha(theme.palette.background.paper, 0.12),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
          transform: `translateY(${rem(theme, -1)})`,
          boxShadow: `${rems(theme, 0, 8, 32)} ${alpha(theme.palette.primary.main, 0.12)}`,
        },
        '&.Mui-expanded': {
          backgroundColor: alpha(theme.palette.background.paper, 0.15),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
        },
      };
    case 'bordered':
      return {
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: theme.spacing(1),
        transition: BASE_TRANSITION,
        '&:before': {
          display: 'none',
        },
        '&:not(:last-child)': {
          marginBottom: theme.spacing(1),
        },
        '&:hover': {
          borderColor: theme.palette.primary.main,
          boxShadow: `${rems(theme, 0, 0, 0, 1)} ${alpha(theme.palette.primary.main, 0.1)}`,
        },
        '&.Mui-expanded': {
          borderColor: theme.palette.primary.main,
        },
      };
    case 'separated':
      return {
        boxShadow: theme.shadows[2],
        borderRadius: theme.spacing(1.5),
        transition: BASE_TRANSITION,
        '&:before': {
          display: 'none',
        },
        '&:not(:last-child)': {
          marginBottom: theme.spacing(2),
        },
        '&:hover': {
          boxShadow: theme.shadows[4],
          transform: `translateY(${rem(theme, -2)})`,
        },
        '&.Mui-expanded': {
          boxShadow: theme.shadows[6],
          transform: `translateY(${rem(theme, -1)})`,
        },
      };
    default:
      return {
        transition: BASE_TRANSITION,
        '&:hover': {
          backgroundColor: alpha(theme.palette.action.hover, 0.04),
        },
      };
  }
};
