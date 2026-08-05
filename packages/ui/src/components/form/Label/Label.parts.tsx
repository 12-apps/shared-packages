import { Box, CircularProgress, useTheme } from '@mui/material';
import React from 'react';

import type { LabelProps } from './Label.types';

/** The required marker, on whichever side the caller asked for. */
export const Asterisk: React.FC<{ placement: NonNullable<LabelProps['asteriskPlacement']> }> = ({
  placement,
}) => {
  const theme = useTheme();

  return (
    <Box
      component="span"
      sx={{
        color: theme.palette.error.main,
        marginLeft: placement === 'end' ? theme.spacing(0.5) : 0,
        marginRight: placement === 'start' ? theme.spacing(0.5) : 0,
      }}
    >
      *
    </Box>
  );
};

export const LabelIcon: React.FC<{ icon: React.ReactNode }> = ({ icon }) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 'inherit' }}>
    {icon}
  </Box>
);

/** Sized to the label's own font so it sits on the text baseline. */
export const LabelSpinner: React.FC<{ fontSize?: CSSStyleDeclaration['fontSize']; color: string }> = ({
  fontSize,
  color,
}) => {
  const theme = useTheme();

  return <CircularProgress size={fontSize} sx={{ color, marginLeft: theme.spacing(0.5) }} />;
};

export interface LabelBodyProps {
  children: React.ReactNode;
  required: boolean;
  asteriskPlacement: NonNullable<LabelProps['asteriskPlacement']>;
  icon?: React.ReactNode;
  iconPosition: NonNullable<LabelProps['iconPosition']>;
  loading: boolean;
  fontSize?: string;
  color: string;
}

/**
 * The run inside the label: the required marker and the icon on whichever side
 * each was asked for, the text, and the spinner after it all.
 */
export const LabelBody: React.FC<LabelBodyProps> = ({
  children,
  required,
  asteriskPlacement,
  icon,
  iconPosition,
  loading,
  fontSize,
  color,
}) => (
  <>
    {required && asteriskPlacement === 'start' && <Asterisk placement={asteriskPlacement} />}
    {icon && iconPosition === 'start' && <LabelIcon icon={icon} />}
    {children}
    {icon && iconPosition === 'end' && <LabelIcon icon={icon} />}
    {required && asteriskPlacement === 'end' && <Asterisk placement={asteriskPlacement} />}
    {loading && <LabelSpinner fontSize={fontSize} color={color} />}
  </>
);
