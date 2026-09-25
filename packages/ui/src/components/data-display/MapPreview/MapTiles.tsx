import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';

import { rem } from '../../../tokens/relative';

import { TILE_WORLD_UNITS } from './mapProjection';
import { tileBackground } from './mapSurface';
import type { MapType } from './MapPreview.types';

// Two extra rows and columns so panning does not expose an edge.
const VISIBLE_TILES = Math.ceil(800 / TILE_WORLD_UNITS) + 2;
// Tile coordinates are only legible once the grid is reasonably fine.
const LABEL_MIN_ZOOM = 10;

export interface MapTilesProps {
  origin: { x: number; y: number } | null;
  zoom: number;
  mapType: MapType;
  panOffset: { x: number; y: number };
}

export const MapTiles: FC<MapTilesProps> = ({ origin, zoom, mapType, panOffset }) => {
  const theme = useTheme();
  const borderOpacity = theme.palette.mode === 'dark' ? 0.15 : 0.1;
  const background = tileBackground(mapType, theme);
  const half = Math.floor(VISIBLE_TILES / 2);
  // A tile is drawn at one design px per world unit, through the type scale.
  const tile = rem(theme, TILE_WORLD_UNITS);
  const grid = rem(theme, TILE_WORLD_UNITS * VISIBLE_TILES);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        // The pan is pointer pixels dragged, so it stays px: the grid follows
        // the cursor exactly, whatever the type scale.
        transform: `translate(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px))`,
        width: grid,
        height: grid,
        display: 'grid',
        gridTemplateColumns: `repeat(${VISIBLE_TILES}, ${tile})`,
        gridTemplateRows: `repeat(${VISIBLE_TILES}, ${tile})`,
        transition: 'transform 0.1s ease-out',
      }}
    >
      {Array.from({ length: VISIBLE_TILES * VISIBLE_TILES }).map((_, index) => {
        // The grid is centred on the origin tile, so indices run from -half.
        const tileX = (origin?.x || 0) + (index % VISIBLE_TILES) - half;
        const tileY = (origin?.y || 0) + Math.floor(index / VISIBLE_TILES) - half;

        return (
          <div
            key={`tile-${tileX}-${tileY}`}
            style={{
              width: tile,
              height: tile,
              border: `1px solid ${alpha(theme.palette.divider, borderOpacity)}`,
              background,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: rem(theme, 10),
              color: alpha(theme.palette.text.secondary, 0.3),
              fontFamily: 'monospace',
              userSelect: 'none',
            }}
          >
            {zoom > LABEL_MIN_ZOOM && `${tileX},${tileY}`}
          </div>
        );
      })}
    </div>
  );
};
