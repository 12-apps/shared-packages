import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { Skeleton } from '../../layout/Skeleton/Skeleton';

import { freshnessOf } from './FleetMap.helpers';
import type { FleetFreshness, FleetMapCopy, FleetUnit } from './FleetMap.types';

/**
 * The roster beside the map — and the ACCESSIBLE half of this component.
 *
 * A map is a picture of positions and a screen reader cannot read a picture, so
 * the panel's information is carried by this list and the map is marked
 * decorative. That is not a consolation prize: the list answers the questions a
 * dispatcher actually asks — who is reporting, how recently, and what are they
 * carrying — and it answers them in an order the map cannot express.
 */

/** Each freshness draws from the semantic palette, never a hardcoded hex. */
function freshnessColor(freshness: FleetFreshness, theme: Theme): string {
  if (freshness === 'live') return theme.palette.success.main;
  if (freshness === 'lagging') return theme.palette.warning.main;
  return theme.palette.text.disabled;
}

interface RowProps {
  unit: FleetUnit;
  copy: FleetMapCopy;
  freshness: FleetFreshness;
  selected: boolean;
  onSelect: (id: string) => void;
  testId: string;
}

function FleetRow({
  unit,
  copy,
  freshness,
  selected,
  onSelect,
  testId,
}: RowProps): React.JSX.Element {
  const theme = useTheme();
  const color = freshnessColor(freshness, theme);
  return (
    <Box
      role="option"
      aria-selected={selected}
      id={`${testId}-option`}
      data-testid={testId}
      data-freshness={freshness}
      onClick={() => onSelect(unit.id)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing(1.5),
        padding: theme.spacing(1, 1.5),
        borderRadius: theme.shape.borderRadius / 4,
        cursor: 'pointer',
        backgroundColor: selected ? theme.palette.action.selected : 'transparent',
        '&:hover': { backgroundColor: theme.palette.action.hover },
      }}
    >
      {/* The dot repeats what the freshness word beside it already says, so it
          is hidden rather than read twice — and colour is never the only
          carrier of the state. */}
      <Box
        aria-hidden="true"
        data-testid={`${testId}-dot`}
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: color,
        }}
      />
      <Stack sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography
          variant="body2"
          component="p"
          data-testid={`${testId}-label`}
          sx={{ fontWeight: theme.typography.fontWeightMedium, overflowWrap: 'anywhere' }}
        >
          {unit.label}
        </Typography>
        <Typography
          variant="caption"
          component="p"
          data-testid={`${testId}-meta`}
          sx={{ color: theme.palette.text.secondary }}
        >
          {[
            copy.freshness[freshness],
            copy.lastSeen(unit.staleSeconds),
            unit.accuracyM == null ? null : copy.accuracy(unit.accuracyM),
          ]
            .filter((part): part is string => Boolean(part))
            .join(' · ')}
        </Typography>
      </Stack>
      {unit.badge && (
        <Typography
          variant="caption"
          component="span"
          data-testid={`${testId}-badge`}
          sx={{ color: theme.palette.text.secondary, flexShrink: 0 }}
        >
          {unit.badge}
        </Typography>
      )}
    </Box>
  );
}

export interface FleetRosterProps {
  units: readonly FleetUnit[];
  copy: FleetMapCopy;
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
  laggingAfterSeconds: number;
  staleAfterSeconds: number;
  loading: boolean;
  testId: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function FleetRoster({
  units,
  copy,
  selectedId,
  onSelect,
  laggingAfterSeconds,
  staleAfterSeconds,
  loading,
  testId,
  onKeyDown,
}: FleetRosterProps): React.JSX.Element {
  const theme = useTheme();

  if (loading) {
    return (
      <Stack spacing={1} data-testid={`${testId}-skeleton`} aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="rectangular" height={44} borderRadius={4} />
        ))}
      </Stack>
    );
  }

  return (
    <Box
      role="listbox"
      // A single tab stop with arrow keys inside, which is the listbox pattern:
      // a dispatcher tabbing past a fleet of thirty should not have to press it
      // thirty times to reach the map.
      tabIndex={0}
      aria-label={copy.rosterLabel}
      aria-activedescendant={selectedId ? `${testId}-${selectedId}-option` : undefined}
      data-testid={`${testId}-roster`}
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(0.5),
        overflowY: 'auto',
        minWidth: 0,
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      }}
    >
      {units.map((unit) => (
        <FleetRow
          key={unit.id}
          unit={unit}
          copy={copy}
          freshness={freshnessOf(unit.staleSeconds, laggingAfterSeconds, staleAfterSeconds)}
          selected={unit.id === selectedId}
          onSelect={onSelect}
          testId={`${testId}-${unit.id}`}
        />
      ))}
    </Box>
  );
}
