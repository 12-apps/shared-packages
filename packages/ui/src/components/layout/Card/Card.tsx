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
    dataTestId,
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

  // A loading card is inert: no handlers fire and pointer events are off, so a
  // half-rendered card cannot be clicked through.
  const idle = !loading;

  return (
    <MuiCard
      data-testid={dataTestId || 'card'}
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
      {...restProps}
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
  dataTestId,
  ...props
}) => {
  if (children) {
    return (
      <Box
        sx={{ p: CARD_HEADER_CHILDREN_PADDING_UNITS }}
        data-testid={dataTestId || 'card-header'}
      >
        {children}
      </Box>
    );
  }

  return (
    <MuiCardHeader
      data-testid={dataTestId || 'card-header'}
      avatar={avatar}
      action={action}
      title={title}
      subheader={subtitle}
      titleTypographyProps={{
        'data-testid': dataTestId ? `${dataTestId}-title` : 'card-title',
      } as Record<string, unknown>}
      subheaderTypographyProps={{
        'data-testid': dataTestId ? `${dataTestId}-subtitle` : 'card-subtitle',
      } as Record<string, unknown>}
      {...props}
    />
  );
};

export const CardContent: React.FC<CardContentProps> = ({ children, dense = false, dataTestId, ...props }) => (
    <MuiCardContent
      data-testid={dataTestId || 'card-content'}
      sx={{
        padding: dense ? CARD_CONTENT_PADDING_UNITS.dense : CARD_CONTENT_PADDING_UNITS.normal,
        '&:last-child': {
          paddingBottom: dense ? CARD_CONTENT_PADDING_UNITS.dense : CARD_CONTENT_PADDING_UNITS.normal,
        },
      }}
      {...props}
    >
      {children}
    </MuiCardContent>
  );

export const CardActions: React.FC<CardActionsProps> = ({
  children,
  disableSpacing = false,
  alignment = 'left',
  dataTestId,
  ...props
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
      data-testid={dataTestId || 'card-actions'}
      disableSpacing={disableSpacing}
      sx={{
        justifyContent: getJustifyContent(),
      }}
      {...props}
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
  dataTestId,
  ...props
}) => (
    <MuiCardMedia
      data-testid={dataTestId || 'card-media'}
      component={component}
      height={height}
      image={image}
      title={title}
      {...props}
    >
      {children}
    </MuiCardMedia>
  );
