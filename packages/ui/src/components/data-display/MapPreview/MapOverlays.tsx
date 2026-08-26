import { useTheme } from '@mui/material/styles/index.js';
import type { CSSProperties, FC } from 'react';
import React from 'react';

import type { HeatmapPoint } from './MapPreview.types';

const OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 1,
};

const MAX_HEAT_RADIUS = 30;
const MAX_HEAT_OPACITY = 0.3;
const DEGREES_TO_PIXELS = 10;

export interface HeatmapOverlayProps {
  points: HeatmapPoint[];
  width: number;
  height: number;
}

// Each point's weight drives both its radius and its opacity, so denser areas
// read hotter where circles overlap.
export const HeatmapOverlay: FC<HeatmapOverlayProps> = ({ points, width, height }) => {
  const theme = useTheme();

  if (points.length === 0) return null;

  return (
    <svg style={OVERLAY_STYLE} viewBox={`0 0 ${width} ${height}`}>
      {points.map((point, index) => (
        <circle
          key={`${point.lat}-${point.lng}-${index}`}
          cx={width / 2 + point.lng * DEGREES_TO_PIXELS}
          cy={height / 2 - point.lat * DEGREES_TO_PIXELS}
          r={MAX_HEAT_RADIUS * point.weight}
          fill={theme.palette.error.main}
          opacity={MAX_HEAT_OPACITY * point.weight}
        />
      ))}
    </svg>
  );
};

export const RouteOverlay: FC<{ color: string }> = ({ color }) => {
  const theme = useTheme();

  return (
    <svg style={OVERLAY_STYLE} viewBox="0 0 100 100">
      <path
        d="M 20,20 Q 40,10 50,30 T 80,80"
        stroke={color || theme.palette.primary.main}
        strokeWidth="3"
        fill="none"
        strokeDasharray="5,5"
        opacity="0.8"
      >
        {/* Marching-ants dashes to suggest direction of travel. */}
        <animate attributeName="stroke-dashoffset" values="0;10" dur="1s" repeatCount="indefinite" />
      </path>
    </svg>
  );
};
