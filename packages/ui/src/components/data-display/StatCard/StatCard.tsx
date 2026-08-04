import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import RemoveIcon from '@mui/icons-material/Remove';
import { Box, Stack, Typography, useTheme, type Theme } from '@mui/material';
import React from 'react';

import { Skeleton } from '../../layout/Skeleton/Skeleton';

import type {
  StatCardDelta,
  StatCardDeltaDirection,
  StatCardDeltaTone,
  StatCardProps,
} from './StatCard.types';

/** The arrow each direction renders (decorative — the text carries the meaning). */
const DIRECTION_ICON: Record<StatCardDeltaDirection, typeof ArrowUpwardIcon> = {
  up: ArrowUpwardIcon,
  down: ArrowDownwardIcon,
  neutral: RemoveIcon,
};

/** How each direction reads to a screen reader when no `ariaLabel` is given. */
const DIRECTION_WORD: Record<StatCardDeltaDirection, string> = {
  up: 'Increase of',
  down: 'Decrease of',
  neutral: 'Change of',
};

/** A direction's natural tone, used when the caller doesn't override it. */
const IMPLIED_TONE: Record<StatCardDeltaDirection, StatCardDeltaTone> = {
  up: 'positive',
  down: 'negative',
  neutral: 'neutral',
};

/** Resolve a tone to its semantic palette colour (never a hardcoded hex). */
function toneColor(tone: StatCardDeltaTone, theme: Theme): string {
  if (tone === 'positive') return theme.palette.success.main;
  if (tone === 'negative') return theme.palette.error.main;
  return theme.palette.text.secondary;
}

/** The screen-reader sentence for a delta: caller override, else generated. */
function deltaAriaLabel(delta: StatCardDelta): string {
  if (delta.ariaLabel) return delta.ariaLabel;
  const suffix = delta.label ? ` ${delta.label}` : '';
  return `${DIRECTION_WORD[delta.direction]} ${delta.value}${suffix}`;
}

/** The delta row: a decorative arrow plus the pre-formatted change and context. */
function DeltaRow({ delta, testId }: { delta: StatCardDelta; testId: string }): React.JSX.Element {
  const theme = useTheme();
  const tone = delta.tone ?? IMPLIED_TONE[delta.direction];
  const Icon = DIRECTION_ICON[delta.direction];
  const color = toneColor(tone, theme);

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      data-testid={testId}
      data-direction={delta.direction}
      data-tone={tone}
    >
      {/* The arrow duplicates what the aria-label already says, so it is hidden
          from assistive tech rather than read twice. */}
      <Icon aria-hidden="true" sx={{ fontSize: '1rem', color }} />
      <Typography
        variant="body2"
        component="span"
        aria-label={deltaAriaLabel(delta)}
        sx={{ color, fontWeight: theme.typography.fontWeightMedium }}
      >
        {delta.value}
      </Typography>
      {delta.label && (
        <Typography variant="caption" component="span" sx={{ color: theme.palette.text.secondary }}>
          {delta.label}
        </Typography>
      )}
    </Stack>
  );
}

/** The label row: the optional decorative icon plus the metric's name. */
function LabelRow({
  label,
  icon,
  labelId,
  testId,
}: Pick<StatCardProps, 'label' | 'icon'> & {
  labelId: string;
  testId: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {icon && (
        <Box
          aria-hidden="true"
          data-testid={`${testId}-icon`}
          sx={{ display: 'flex', color: theme.palette.text.secondary }}
        >
          {icon}
        </Box>
      )}
      <Typography
        id={labelId}
        variant="caption"
        component="p"
        data-testid={`${testId}-label`}
        sx={{ color: theme.palette.text.secondary }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

/** The figure itself, or its skeleton while the tile is loading. */
function ValueRow({
  value,
  loading,
  testId,
}: Pick<StatCardProps, 'value' | 'loading'> & { testId: string }): React.JSX.Element {
  const theme = useTheme();
  if (loading) {
    return (
      <Skeleton
        variant="rectangular"
        height={28}
        width="60%"
        borderRadius={4}
        data-testid={`${testId}-value-skeleton`}
      />
    );
  }
  return (
    <Typography
      variant="h6"
      component="p"
      data-testid={`${testId}-value`}
      sx={{
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.palette.text.primary,
        overflowWrap: 'anywhere',
      }}
    >
      {value}
    </Typography>
  );
}

/** The delta slot: its skeleton while loading, the row once resolved, else nothing. */
function DeltaSlot({
  delta,
  loading,
  testId,
}: {
  delta?: StatCardDelta;
  loading: boolean;
  testId: string;
}): React.JSX.Element | null {
  if (!delta) return null;
  if (loading) {
    return (
      <Skeleton
        variant="rectangular"
        height={16}
        width="40%"
        borderRadius={4}
        data-testid={`${testId}-delta-skeleton`}
      />
    );
  }
  return <DeltaRow delta={delta} testId={`${testId}-delta`} />;
}

/**
 * StatCard (KPI tile) — one labelled figure with an optional period-over-period
 * delta, leading icon, hint line and loading state. The single shared tile for
 * dashboards and summary bands, so surfaces stop hand-rolling the pattern.
 *
 * The tile is presentation only: `value` and `delta.value` arrive ALREADY
 * formatted, so locale/currency rules stay with the data owner. Colour comes
 * from the MUI palette (`success` / `error` / `text.secondary`), and the delta's
 * meaning is separable from its arrow via {@link StatCardDelta.tone} — a rise in
 * cost can render "up" while reading as negative.
 */
export const StatCard: React.FC<StatCardProps> = React.memo(
  ({ label, value, delta, icon, hint, loading = false, className, dataTestId }) => {
    const theme = useTheme();
    const labelId = React.useId();
    const testId = dataTestId || 'stat-card';

    return (
      <Box
        role="group"
        aria-labelledby={labelId}
        aria-busy={loading || undefined}
        className={className}
        data-testid={testId}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing(0.5),
          padding: theme.spacing(2),
          borderRadius: theme.shape.borderRadius / 4,
          border: `1px solid ${theme.palette.divider}`,
          backgroundColor: theme.palette.background.paper,
          minWidth: 0,
        }}
      >
        <LabelRow label={label} icon={icon} labelId={labelId} testId={testId} />
        <ValueRow value={value} loading={loading} testId={testId} />
        <DeltaSlot delta={delta} loading={loading} testId={testId} />
        {hint && (
          <Typography
            variant="caption"
            component="p"
            data-testid={`${testId}-hint`}
            sx={{ color: theme.palette.text.secondary }}
          >
            {hint}
          </Typography>
        )}
      </Box>
    );
  },
);

StatCard.displayName = 'StatCard';

export default StatCard;
