import Box from '@mui/material/Box/index.js';
import MuiCard from '@mui/material/Card/index.js';
import MuiCardActions from '@mui/material/CardActions/index.js';
import MuiCardContent from '@mui/material/CardContent/index.js';
import MuiCardHeader from '@mui/material/CardHeader/index.js';
import MuiCardMedia from '@mui/material/CardMedia/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { resolveCardProps } from './Card.helpers';
import {
  CARD_CONTENT_PADDING_UNITS,
  CARD_HEADER_CHILDREN_PADDING_UNITS,
  CARD_LOADING,
  CARD_MEDIA_HEIGHT,
} from './Card.metrics';
import { cardStyles } from './Card.styles';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import type {
  CardActionsProps,
  CardContentProps,
  CardHeaderProps,
  CardMediaProps,
  CardProps,
} from './Card.types';

export const Card: React.FC<CardProps> = (rawProps) => {
  const {
    children,
    variant,
    interactive,
    glow,
    pulse,
    borderRadius,
    loading,
    onClick,
    onFocus,
    onBlur,
    sx,
    // These props are reserved for future implementation but need to be extracted
    // to prevent them from being passed to the underlying MuiCard
    expandable: _expandable,
    expanded: _expanded,
    onExpandToggle: _onExpandToggle,
    entranceAnimation: _entranceAnimation,
    animationDelay: _animationDelay,
    skeleton: _skeleton,
    hoverScale: _hoverScale,
    ...restProps
  } = resolveCardProps(rawProps);

  const theme = useTheme();
  // Every spelling of the test id the shared contract allows, mapped to the one
  // the DOM reads, and stripped from what is spread — `testID` is React
  // Native's name for it and is not a DOM attribute. The native `Card` does the
  // same in reverse.
  const ownTestId = resolveTestId(restProps, 'card');
  const props = withoutTestIdProps(restProps);

  // A loading card is inert: no handlers fire and pointer events are off, so a
  // half-rendered card cannot be clicked through.
  const idle = !loading;

  return (
    <MuiCard
      data-testid={ownTestId}
      onClick={idle ? onClick : undefined}
      onFocus={idle ? onFocus : undefined}
      onBlur={idle ? onBlur : undefined}
      sx={{
        ...cardStyles(theme, { variant, interactive, glow, pulse, borderRadius }),
        position: 'relative',
        opacity: loading ? CARD_LOADING.opacity : 1,
        pointerEvents: loading ? 'none' : 'auto',
        ...sx,
      }}
      {...props}
    >
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: CARD_LOADING.spinnerZIndex,
          }}
        >
          <CircularProgress />
        </Box>
      )}
      {children}
    </MuiCard>
  );
};

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  avatar,
  children,
  ...others
}) => {
  const ownTestId = resolveTestId(others, 'card-header');
  const props = withoutTestIdProps(others);

  if (children) {
    return (
      <Box sx={{ p: CARD_HEADER_CHILDREN_PADDING_UNITS }} data-testid={ownTestId}>
        {children}
      </Box>
    );
  }

  return (
    <MuiCardHeader
      data-testid={ownTestId}
      avatar={avatar}
      action={action}
      title={title}
      subheader={subtitle}
      titleTypographyProps={{
        'data-testid': childTestId(others, 'title', 'card'),
      } as Record<string, unknown>}
      subheaderTypographyProps={{
        'data-testid': childTestId(others, 'subtitle', 'card'),
      } as Record<string, unknown>}
      {...props}
    />
  );
};

export const CardContent: React.FC<CardContentProps> = ({ children, dense = false, ...others }) => (
    <MuiCardContent
      data-testid={resolveTestId(others, 'card-content')}
      sx={{
        padding: dense ? CARD_CONTENT_PADDING_UNITS.dense : CARD_CONTENT_PADDING_UNITS.normal,
        '&:last-child': {
          paddingBottom: dense ? CARD_CONTENT_PADDING_UNITS.dense : CARD_CONTENT_PADDING_UNITS.normal,
        },
      }}
      {...withoutTestIdProps(others)}
    >
      {children}
    </MuiCardContent>
  );

export const CardActions: React.FC<CardActionsProps> = ({
  children,
  disableSpacing = false,
  alignment = 'left',
  ...others
}) => {
  const getJustifyContent = () => {
    switch (alignment) {
      case 'center':
        return 'center';
      case 'right':
        return 'flex-end';
      case 'space-between':
        return 'space-between';
      default:
        return 'flex-start';
    }
  };

  return (
    <MuiCardActions
      data-testid={resolveTestId(others, 'card-actions')}
      disableSpacing={disableSpacing}
      sx={{
        justifyContent: getJustifyContent(),
      }}
      {...withoutTestIdProps(others)}
    >
      {children}
    </MuiCardActions>
  );
};

export const CardMedia: React.FC<CardMediaProps> = ({
  component = 'div',
  image,
  title,
  height = CARD_MEDIA_HEIGHT,
  children,
  ...others
}) => (
    <MuiCardMedia
      data-testid={resolveTestId(others, 'card-media')}
      component={component}
      height={height}
      image={image}
      title={title}
      {...withoutTestIdProps(others)}
    >
      {children}
    </MuiCardMedia>
  );
