import type { Theme } from '@mui/material';
import { alpha } from '@mui/material';

import type { MapType } from './MapPreview.types';

type GreyShade = keyof Theme['palette']['grey'];

const greyGradient = (theme: Theme, from: GreyShade, to: GreyShade, opacity = 1): string => {
  const shade = (key: GreyShade) => alpha(theme.palette.grey[key], opacity);
  return `linear-gradient(135deg, ${shade(from)} 0%, ${shade(to)} 100%)`;
};

// The backdrop behind the tiles: dark for satellite, green for terrain, and
// grey for road maps, following the theme's own light/dark choice.
export const surfaceBackground = (mapType: MapType, theme: Theme): string => {
  if (mapType === 'satellite') return greyGradient(theme, 900, 800);
  if (mapType === 'terrain') {
    return `linear-gradient(135deg, ${alpha('#8BC34A', 0.2)} 0%, ${alpha('#4CAF50', 0.3)} 100%)`;
  }
  if (theme.palette.mode === 'dark') return greyGradient(theme, 900, 800);
  return greyGradient(theme, 100, 200);
};

export const tileBackground = (mapType: MapType, theme: Theme): string => {
  if (mapType === 'satellite') {
    return `linear-gradient(135deg, ${alpha('#1a1a1a', 0.9)} 0%, ${alpha('#2a2a2a', 0.9)} 100%)`;
  }
  if (mapType === 'terrain') {
    return `linear-gradient(135deg, ${alpha('#7cb342', 0.1)} 0%, ${alpha('#558b2f', 0.1)} 100%)`;
  }
  return greyGradient(theme, 100, 200, 0.5);
};

export const BOUNCE_KEYFRAMES = {
  '0%, 100%': { transform: 'translateY(0)' },
  '50%': { transform: 'translateY(-10px)' },
} as const;
