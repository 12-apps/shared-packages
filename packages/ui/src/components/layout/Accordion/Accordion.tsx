import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { 
  Accordion as MuiAccordion,
  AccordionActions as MuiAccordionActions,
  AccordionDetails as MuiAccordionDetails,
  AccordionSummary as MuiAccordionSummary,
  alpha,
  useTheme} from '@mui/material';
import React from 'react';

import { accordionVariantStyles } from './Accordion.styles';
import type { 
  AccordionActionsProps, 
  AccordionDetailsProps, 
  AccordionProps, 
  AccordionSummaryProps} from './Accordion.types';

export const Accordion: React.FC<AccordionProps> = ({
  children,
  variant = 'default',
  disabled = false,
  defaultExpanded = false,
  expanded,
  onChange,
  sx,
  'data-testid': testId = 'accordion',
  ...props
}) => {
  const theme = useTheme();

  return (
    <MuiAccordion
      disabled={disabled}
      defaultExpanded={defaultExpanded}
      expanded={expanded}
      onChange={onChange}
      data-testid={testId}
      sx={{
        ...accordionVariantStyles(theme, variant),
        ...sx,
      }}
      {...props}
    >
      {children}
    </MuiAccordion>
  );
};

export const AccordionSummary: React.FC<AccordionSummaryProps> = ({
  children,
  expandIcon = <ExpandMoreIcon />,
  disabled = false,
  'data-testid': testId = 'accordion-summary',
  ...props
}) => {
  const theme = useTheme();

  // Clone expandIcon to add data-testid if it's a valid React element
  const iconWithTestId = React.isValidElement(expandIcon)
    ? React.cloneElement(expandIcon as React.ReactElement<{ 'data-testid'?: string }>, {
        'data-testid': 'accordion-icon',
      })
    : expandIcon;

  return (
    <MuiAccordionSummary
      expandIcon={iconWithTestId}
      disabled={disabled}
      data-testid={testId}
      sx={{
        minHeight: 56,
        '& .MuiAccordionSummary-expandIconWrapper': {
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          color: theme.palette.text.secondary,
        },
        '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
          transform: 'rotate(180deg)',
          color: theme.palette.primary.main,
        },
        '&:hover': {
          backgroundColor: alpha(theme.palette.action.hover, 0.04),
          '& .MuiAccordionSummary-expandIconWrapper': {
            color: theme.palette.primary.main,
          },
        },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        // Enhanced keyboard navigation styles
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
      {...props}
    >
      {children}
    </MuiAccordionSummary>
  );
};

export const AccordionDetails: React.FC<AccordionDetailsProps> = ({
  children,
  'data-testid': testId = 'accordion-details',
  ...props
}) => {
  const theme = useTheme();

  return (
    <MuiAccordionDetails 
      data-testid={testId}
      sx={{
        paddingTop: theme.spacing(1),
        paddingBottom: theme.spacing(2),
        borderTop: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
        // Smooth content reveal animation
        '& > *': {
          animation: 'fadeInUp 0.4s ease-out',
        },
        '@keyframes fadeInUp': {
          '0%': {
            opacity: 0,
            transform: 'translateY(8px)',
          },
          '100%': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        },
      }}
      {...props}
    >
      {children}
    </MuiAccordionDetails>
  );
};

export const AccordionActions: React.FC<AccordionActionsProps> = ({
  children,
  disableSpacing = false,
  'data-testid': testId = 'accordion-actions',
  ...props
}) => {
  const theme = useTheme();

  return (
    <MuiAccordionActions 
      disableSpacing={disableSpacing}
      data-testid={testId}
      sx={{
        padding: theme.spacing(1, 2),
        borderTop: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
        backgroundColor: alpha(theme.palette.background.paper, 0.5),
        backdropFilter: 'blur(8px)',
        // Animate button entries
        '& > *': {
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-1px)',
          },
        },
      }}
      {...props}
    >
      {children}
    </MuiAccordionActions>
  );
};