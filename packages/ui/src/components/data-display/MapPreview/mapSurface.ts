import type { Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import type { MapType } from './MapPreview.types';
import { neutralTones, uiInk } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

const toneGradient = (from: string, to: string, opacity = 1): string =>
  `linear-gradient(135deg, ${alpha(from, opacity)} 0%, ${alpha(to, opacity)} 100%)`;

// The backdrop behind the tiles: dark for satellite, green for terrain, and
// grey for road maps, following the theme's own light/dark choice.
export const surfaceBackground = (mapType: MapType, theme: Theme): string => {
  const tones = neutralTones(theme);
  if (mapType === 'satellite') return toneGradient(tones.inverseSurface, tones.raised);
  if (mapType === 'terrain') {
    const ground = uiInk(theme).mapSurface;
    return `linear-gradient(135deg, ${alpha(ground.terrainFrom, 0.2)} 0%, ${alpha(ground.terrainTo, 0.3)} 100%)`;
  }
  if (theme.palette.mode === 'dark') return toneGradient(tones.inverseSurface, tones.raised);
  return toneGradient(tones.surface, tones.faint);
};

export const tileBackground = (mapType: MapType, theme: Theme): string => {
  const ground = uiInk(theme).mapSurface;
  if (mapType === 'satellite') {
    return `linear-gradient(135deg, ${alpha(ground.satelliteTileFrom, 0.9)} 0%, ${alpha(ground.satelliteTileTo, 0.9)} 100%)`;
  }
  if (mapType === 'terrain') {
    return `linear-gradient(135deg, ${alpha(ground.terrainTileFrom, 0.1)} 0%, ${alpha(ground.terrainTileTo, 0.1)} 100%)`;
  }
  const tones = neutralTones(theme);
  return toneGradient(tones.surface, tones.faint, 0.5);
};

export const bounceKeyframes = (theme: Theme) =>
  ({
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: `translateY(${rem(theme, -10)})` },
  }) as const;
