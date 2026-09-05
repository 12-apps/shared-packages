import MuiContainer from '@mui/material/Container/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import {
  CONTAINER_COMPACT_PADDING_UNITS,
  CONTAINER_PADDED_VERTICAL_UNITS,
  containerPaddingUnits,
  resolveContainerMaxWidth,
} from './Container.metrics';
import type { ContainerProps } from './Container.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';

export const Container: React.FC<ContainerProps> = ({
  children,
  maxWidth = 'lg',
  variant = 'default',
  padding = 'md',
  responsive = true,
  sx,
  ...others
}) => {
  const theme = useTheme();
  // `testID` and `dataTestId` are the shared contract's spellings; the DOM
  // wants `data-testid`, and must not see the other two as attributes.
  const testId = resolveTestId(others, 'container');
  const props = withoutTestIdProps(others);

  // From the shared metrics, not tables of our own: the native `Container`
  // reads the same units and the same max-width rule, so the two renderers
  // cannot disagree on an inset or a column width.
  const containerStyles: SxProps<Theme> = {
    ...(variant === 'centered' && {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
    }),
    ...(variant === 'padded' && {
      paddingTop: theme.spacing(CONTAINER_PADDED_VERTICAL_UNITS),
      paddingBottom: theme.spacing(CONTAINER_PADDED_VERTICAL_UNITS),
    }),
    padding: theme.spacing(containerPaddingUnits(padding, false)),
    ...(responsive && {
      [theme.breakpoints.down('sm')]: {
        padding: theme.spacing(CONTAINER_COMPACT_PADDING_UNITS),
      },
    }),
    ...(sx || {}),
  };

  return (
    <MuiContainer
      maxWidth={resolveContainerMaxWidth(variant, maxWidth)}
      sx={containerStyles}
      data-testid={testId}
      {...props}
    >
      {children}
    </MuiContainer>
  );
};
