import Box from '@mui/material/Box/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled, useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type { FC, ReactElement } from 'react';
import React from 'react';

import type { TimingData } from './TimingDiagram.types';
import { onMedia, sheen, uiInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

export type PhaseKey = 'dns' | 'connect' | 'ssl' | 'request' | 'response';

// Each phase's colour, from the theme's named timing set (`uiInk`).
export const phaseColors = (theme: Theme): Record<PhaseKey, string> => {
  const phases = uiInk(theme).timingPhases;
  return {
    dns: phases.dns,
    connect: phases.connect,
    ssl: phases.tls,
    request: phases.request,
    response: phases.response,
  };
};

export interface Phase {
  key: string;
  label: string;
  value?: number;
}

export interface TimingViewProps {
  phases: Phase[];
  percentages: Record<string, number>;
  data: TimingData;
  animated: boolean;
  showLabels: boolean;
  showTooltips: boolean;
  /** The waterfall's plot height in design px — drawn through `rem`. */
  plotHeightPx: number;
}

export const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const colorOf = (theme: Theme, phase: Phase): string => phaseColors(theme)[phase.key as PhaseKey];
const widthOf = (percentages: Record<string, number>, phase: Phase): number =>
  percentages[phase.key] ?? 0;

// Waterfall and stacked both offer the same hover explanation of a segment; only
// whether tooltips are on at all varies.
const withTooltip = (
  phase: Phase,
  enabled: boolean,
  element: ReactElement,
): ReactElement =>
  enabled ? (
    <Tooltip
      key={phase.key}
      title={`${phase.label}: ${formatTime(phase.value!)}`}
      placement="top"
      role="tooltip"
      aria-describedby={`tooltip-${phase.key}`}
    >
      {element}
    </Tooltip>
  ) : (
    element
  );

const WaterfallContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  width: '100%',
  marginTop: theme.spacing(2),
}));

const WaterfallBar = styled(Box, {
  shouldForwardProp: (prop) =>
    !['phaseColor', 'offset', 'widthPct', 'animated'].includes(prop as string),
})<{
  phaseColor: string;
  offset: number;
  widthPct: number;
  animated: boolean;
}>(({ theme, phaseColor, offset, widthPct, animated }) => ({
  position: 'absolute',
  height: rem(theme, 32),
  left: `${offset}%`,
  width: `${widthPct}%`,
  background: `linear-gradient(90deg, ${phaseColor} 0%, ${alpha(phaseColor, 0.8)} 100%)`,
  borderRadius: theme.shape.borderRadius,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.getContrastText(phaseColor),
  fontSize: rem(theme, 12),
  fontWeight: 500,
  boxShadow: `${rems(theme, 0, 2, 8)} ${alpha(phaseColor, 0.3)}`,
  transition: animated ? 'all 0.5s ease' : 'none',
  animation: animated ? 'slideIn 0.5s ease' : 'none',
  '@keyframes slideIn': {
    from: {
      transform: `translateX(${rem(theme, -20)})`,
      opacity: 0,
    },
    to: {
      transform: 'translateX(0)',
      opacity: 1,
    },
  },
  '&:hover': {
    transform: `translateY(${rem(theme, -2)})`,
    boxShadow: `${rems(theme, 0, 4, 12)} ${alpha(phaseColor, 0.5)}`,
    zIndex: 10,
  },
}));

const TimelineAxis = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: theme.spacing(1),
  paddingTop: theme.spacing(1),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}));

const TimeLabel = styled(Typography)(({ theme }) => ({
  fontSize: rem(theme, 11.2),
  color: theme.palette.text.secondary,
  fontWeight: 500,
}));

export const WaterfallView: FC<TimingViewProps> = ({
  phases,
  percentages,
  data,
  animated,
  showLabels,
  showTooltips,
  plotHeightPx,
}) => {
  const theme = useTheme();
  // Each bar starts where the previous one ended, so the row reads as a timeline.
  let offset = 0;

  return (
    <WaterfallContainer style={{ height: rem(theme, plotHeightPx + 40) }} data-variant="waterfall">
      {phases.map((phase, index) => {
        const width = widthOf(percentages, phase);
        const currentOffset = offset;
        offset += width;

        return withTooltip(
          phase,
          showTooltips,
          <WaterfallBar
            key={phase.key}
            data-testid={`timing-segment-${phase.key}`}
            phaseColor={colorOf(theme, phase)}
            offset={currentOffset}
            widthPct={width}
            animated={animated}
            data-animated={animated.toString()}
            style={{
              top: rem(theme, index * 8),
              width: `${width}%`,
              left: `${currentOffset}%`,
            }}
          >
            {showLabels && width > 10 && (
              <span data-testid="timing-label">{formatTime(phase.value!)}</span>
            )}
          </WaterfallBar>,
        );
      })}
      <TimelineAxis style={{ marginTop: rem(theme, plotHeightPx) }}>
        <TimeLabel>0ms</TimeLabel>
        <TimeLabel>{formatTime(data.total / 2)}</TimeLabel>
        <TimeLabel>{formatTime(data.total)}</TimeLabel>
      </TimelineAxis>
    </WaterfallContainer>
  );
};

const StackedBar = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'animated',
})<{ animated: boolean }>(({ theme, animated }) => ({
  display: 'flex',
  width: '100%',
  height: rem(theme, 40),
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
  boxShadow: theme.shadows[2],
  ...(animated && {
    '& > div': {
      animation: 'expandWidth 0.8s ease',
    },
    '@keyframes expandWidth': {
      from: { width: 0 },
      to: { width: '100%' },
    },
  }),
}));

const StackedSegment = styled(Box, {
  shouldForwardProp: (prop) => !['phaseColor', 'widthPct'].includes(prop as string),
})<{ phaseColor: string; widthPct: number }>(({ theme, phaseColor, widthPct }) => ({
  width: `${widthPct}%`,
  background: `linear-gradient(135deg, ${phaseColor} 0%, ${alpha(phaseColor, 0.85)} 100%)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: onMedia(theme),
  fontSize: rem(theme, 11.2),
  fontWeight: 600,
  position: 'relative',
  transition: 'all 0.3s ease',
  '&:hover': {
    filter: 'brightness(1.1)',
    zIndex: 1,
  },
}));

export const StackedView: FC<TimingViewProps> = ({
  phases,
  percentages,
  data,
  animated,
  showLabels,
  showTooltips,
}) => {
  const theme = useTheme();
  return (
    <Box data-variant="stacked">
      <StackedBar animated={animated} data-animated={animated.toString()}>
        {phases.map((phase) => {
          const width = widthOf(percentages, phase);

          return withTooltip(
            phase,
            showTooltips,
            <StackedSegment
              key={phase.key}
              data-testid={`timing-segment-${phase.key}`}
              phaseColor={colorOf(theme, phase)}
              widthPct={width}
              style={{ width: `${width}%` }}
            >
              {showLabels && width > 10 && (
                <span data-testid="timing-label">{formatTime(phase.value!)}</span>
              )}
            </StackedSegment>,
          );
        })}
      </StackedBar>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          0ms
        </Typography>
        <Typography variant="caption" color="text.secondary" fontWeight="bold">
          Total: {formatTime(data.total)}
        </Typography>
      </Box>
    </Box>
  );
};

const HorizontalBar = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
  marginTop: theme.spacing(2),
}));

const HorizontalSegment = styled(Box, {
  shouldForwardProp: (prop) => !['phaseColor', 'widthPct', 'animated'].includes(prop as string),
})<{
  phaseColor: string;
  widthPct: number;
  animated: boolean;
}>(({ theme, phaseColor, animated }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  '& .label': {
    minWidth: rem(theme, 80),
    fontSize: rem(theme, 13.6),
    fontWeight: 500,
    color: theme.palette.text.secondary,
  },
  '& .bar': {
    flex: 1,
    height: rem(theme, 24),
    borderRadius: theme.shape.borderRadius,
    background: `linear-gradient(90deg, ${phaseColor} 0%, ${alpha(phaseColor, 0.7)} 100%)`,
    position: 'relative',
    overflow: 'hidden',
    boxShadow: `${rems(theme, 0, 2, 6)} ${alpha(phaseColor, 0.25)}`,
    ...(animated && {
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `linear-gradient(90deg, transparent 0%, ${sheen(theme, 0.3)} 50%, transparent 100%)`,
        animation: 'shimmer 2s infinite',
      },
      '@keyframes shimmer': {
        from: { transform: 'translateX(-100%)' },
        to: { transform: 'translateX(100%)' },
      },
    }),
  },
  '& .value': {
    minWidth: rem(theme, 60),
    textAlign: 'right',
    fontSize: rem(theme, 13.6),
    fontWeight: 600,
    color: phaseColor,
  },
}));

export const HorizontalView: FC<TimingViewProps> = ({
  phases,
  percentages,
  data,
  animated,
}) => {
  const theme = useTheme();

  return (
    <HorizontalBar data-variant="horizontal">
      {phases.map((phase) => (
        <HorizontalSegment
          key={phase.key}
          data-testid={`timing-segment-${phase.key}`}
          phaseColor={colorOf(theme, phase)}
          widthPct={widthOf(percentages, phase)}
          animated={animated}
          data-animated={animated.toString()}
        >
          <Typography className="label">{phase.label}</Typography>
          <Box className="bar" style={{ width: `${percentages[phase.key]}%` }} />
          <Typography className="value" data-testid="timing-label">
            {formatTime(phase.value!)}
          </Typography>
        </HorizontalSegment>
      ))}
      <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}` }}>
        <Typography variant="body2" fontWeight="bold" color="primary">
          Total Time: {formatTime(data.total)}
        </Typography>
      </Box>
    </HorizontalBar>
  );
};
