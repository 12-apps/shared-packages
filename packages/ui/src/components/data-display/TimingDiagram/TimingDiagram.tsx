import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { alpha, styled } from '@mui/material/styles';
import type { FC } from 'react';
import React, { useMemo } from 'react';

import type { TimingData, TimingDiagramProps } from './TimingDiagram.types';
import type { Phase, PhaseKey, TimingViewProps } from './TimingDiagram.views';
import {
  HorizontalView,
  phaseColors,
  StackedView,
  WaterfallView,
} from './TimingDiagram.views';

// Styled components
const DiagramContainer = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.8)} 100%)`,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
}));

const Legend = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(2),
  marginTop: theme.spacing(2),
  paddingTop: theme.spacing(2),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}));

const LegendItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  '& .color': {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  '& .label': {
    fontSize: '0.8rem',
    color: theme.palette.text.secondary,
  },
}));

// Helper functions
const calculatePercentages = (data: TimingData): Record<string, number> => {
  const total = data.total || 1;
  return {
    dns: ((data.dns || 0) / total) * 100,
    connect: ((data.connect || 0) / total) * 100,
    ssl: ((data.ssl || 0) / total) * 100,
    request: ((data.request || 0) / total) * 100,
    response: ((data.response || 0) / total) * 100,
  };
};

// A phase with no recorded time never happened — an HTTP request has no SSL
// handshake, for instance — so it gets no bar and no legend entry.
const phasesOf = (data: TimingData): Phase[] =>
  [
    { key: 'dns', label: 'DNS Lookup', value: data.dns },
    { key: 'connect', label: 'Connection', value: data.connect },
    { key: 'ssl', label: 'SSL/TLS', value: data.ssl },
    { key: 'request', label: 'Request', value: data.request },
    { key: 'response', label: 'Response', value: data.response },
  ].filter((phase) => phase.value !== undefined && phase.value > 0);

const VIEWS: Record<string, FC<TimingViewProps>> = {
  waterfall: WaterfallView,
  stacked: StackedView,
  horizontal: HorizontalView,
};

// Main component
export const TimingDiagram: FC<TimingDiagramProps> = ({
  copy,
  data,
  showLabels = true,
  height = 40,
  animated = true,
  showTooltips = true,
  variant = 'waterfall',
}) => {
  const percentages = useMemo(() => calculatePercentages(data), [data]);
  const phases = phasesOf(data);
  const View = VIEWS[variant];

  return (
    <DiagramContainer elevation={2} role="region" aria-label={copy.regionLabel} tabIndex={0}>
      <Typography variant="h6" fontWeight="bold" gutterBottom>
        {copy.heading}
      </Typography>

      {View && (
        <View
          phases={phases}
          percentages={percentages}
          data={data}
          animated={animated}
          showLabels={showLabels}
          showTooltips={showTooltips}
          height={height}
        />
      )}

      {showLabels && (
        <Legend>
          {phases.map((phase) => (
            <LegendItem key={phase.key}>
              <Box
                className="color"
                sx={{ backgroundColor: phaseColors[phase.key as PhaseKey] }}
              />
              <Typography className="label">{phase.label}</Typography>
            </LegendItem>
          ))}
        </Legend>
      )}
    </DiagramContainer>
  );
};

// Export default
export default TimingDiagram;
