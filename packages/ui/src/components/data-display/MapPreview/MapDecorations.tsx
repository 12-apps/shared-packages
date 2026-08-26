import LocationIcon from '@mui/icons-material/LocationOn';
import NavigationIcon from '@mui/icons-material/Navigation';
import PlaceIcon from '@mui/icons-material/Place';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import type { FC } from 'react';
import React from 'react';

import { getScaleDistance } from './mapProjection';
import { BOUNCE_KEYFRAMES } from './mapSurface';

// Decorative only: these give the mock surface something to look like without
// standing in for real map data.
export const MapRoads: FC = () => {
  const theme = useTheme();

  return (
    <Box sx={{ position: 'absolute', top: '20%', left: '15%', width: '70%', height: '60%', opacity: 0.2 }}>
      <svg width="100%" height="100%" style={{ position: 'absolute' }}>
        <path
          d="M 10,50 Q 30,30 50,50 T 90,50"
          stroke={theme.palette.text.secondary}
          strokeWidth="2"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M 50,10 L 50,90"
          stroke={theme.palette.text.secondary}
          strokeWidth="1.5"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M 20,30 L 80,70"
          stroke={theme.palette.text.secondary}
          strokeWidth="1"
          fill="none"
          opacity="0.2"
        />
      </svg>
    </Box>
  );
};

const DecorativePin: FC<{ top: string; left: string }> = ({ top, left }) => {
  const theme = useTheme();

  return (
    <Box sx={{ position: 'absolute', top, left, opacity: 0.6 }}>
      <PlaceIcon sx={{ fontSize: 20, color: theme.palette.primary.main }} />
    </Box>
  );
};

export const MapDecorativePins: FC = () => (
  <>
    <DecorativePin top="30%" left="25%" />
    <DecorativePin top="65%" left="70%" />
  </>
);

export const MapCentreMarker: FC = () => {
  const theme = useTheme();

  return (
    <Box
      data-testid="map-marker"
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -100%)',
        zIndex: 2,
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
      }}
    >
      <LocationIcon
        sx={{
          fontSize: 36,
          color: theme.palette.error.main,
          animation: 'bounce 2s infinite',
          '@keyframes bounce': BOUNCE_KEYFRAMES,
        }}
      />
    </Box>
  );
};

export const MapScaleBar: FC<{ zoom: number }> = ({ zoom }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: theme.spacing(2),
        right: theme.spacing(2),
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        padding: theme.spacing(0.5, 1),
        background: alpha(theme.palette.background.paper, 0.9),
        borderRadius: theme.shape.borderRadius,
        fontSize: '0.75rem',
        color: theme.palette.text.secondary,
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 2,
          background: theme.palette.text.secondary,
          position: 'relative',
          // The end caps that make the bar read as a measurement.
          '&::before, &::after': {
            content: '""',
            position: 'absolute',
            width: 2,
            height: 6,
            background: theme.palette.text.secondary,
          },
          '&::before': { left: 0, top: -2 },
          '&::after': { right: 0, top: -2 },
        }}
      />
      <Typography variant="caption">{getScaleDistance(zoom)}</Typography>
    </Box>
  );
};

export const MapCompass: FC = () => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'absolute',
        top: theme.spacing(2),
        left: theme.spacing(2),
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: alpha(theme.palette.background.paper, 0.9),
        borderRadius: '50%',
        boxShadow: theme.shadows[2],
      }}
    >
      <NavigationIcon
        sx={{ fontSize: 24, color: theme.palette.primary.main, transform: 'rotate(-45deg)' }}
      />
    </Box>
  );
};
