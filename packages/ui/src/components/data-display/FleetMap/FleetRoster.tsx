import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { Skeleton } from '../../layout/Skeleton/Skeleton';

import { freshnessOf } from './FleetMap.helpers';
import { FLEET_DOT, FLEET_ROSTER, FLEET_ROW, FLEET_SKELETON } from './FleetMap.metrics';
import type { FleetFreshness, FleetMapCopy, FleetUnit } from './FleetMap.types';

/**
 * The roster beside the map — and the ACCESSIBLE half of this component.
 *
 * A map is a picture of positions and a screen reader cannot read a picture, so
 * the panel's information is carried by this list. That is not a consolation
 * prize: the list answers the questions a dispatcher actually asks — who is
 * reporting, how recently, and what are they carrying — and it answers them in
 * an order the map cannot express.
 *
 * The map beside it is a NAMED LANDMARK rather than an `aria-hidden` one, so a
 * reader can skip it in one gesture — see `FleetCanvas`, which carries the
 * reason it must not be hidden.
 */

/** Each freshness draws from the semantic palette, never a hardcoded hex. */
function freshnessColor(freshness: FleetFreshness, theme: Theme): string {
  if (freshness === 'live') return theme.palette.success.main;
  if (freshness === 'lagging') return theme.palette.warning.main;
  return theme.palette.text.disabled;
}

/**
 * A row's two lines of text — the name, and the one-line summary under it.
 *
 * Split out of `FleetRow` to keep that function under the size gate, and the
 * seam is the natural one: everything here is READ, nothing is interactive.
 */
function RowText({
  unit,
  copy,
  freshness,
  testId,
}: Pick<RowProps, 'unit' | 'copy' | 'freshness' | 'testId'>): React.JSX.Element {
  const theme = useTheme();

  // Dropped rather than rendered empty: a phone that reports no accuracy radius
  // would otherwise print a trailing separator with nothing after it.
  const meta = [
    copy.freshness[freshness],
    copy.lastSeen(unit.staleSeconds),
    unit.accuracyM == null ? null : copy.accuracy(unit.accuracyM),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
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
        {meta}
      </Typography>
    </Stack>
  );
}

/**
 * Keep the selected row visible INSIDE the roster.
 *
 * The roster caps its own height, so a dispatcher arrowing through a fleet of
 * thirty otherwise walks the selection below the fold with nothing moving —
 * `aria-activedescendant` follows, and a SIGHTED keyboard user sees no feedback
 * at all.
 *
 * Watches the row's POSITION as well as its selectedness, because the roster
 * re-sorts on every poll: a rider who stays selected while their staleness
 * moves them down the list would otherwise slide out of view with the effect
 * never re-running.
 *
 * Arithmetic rather than `scrollIntoView({ block: 'nearest' })` because that
 * walks every scrollable ancestor, the document included, and `nearest` only
 * spares an ancestor the row is already visible in — which is exactly false
 * when the panel is off screen. Re-running on every re-sort, it would yank the
 * whole page back to the map on a timer, and drag it there on mount for any
 * board rendered below the fold with a selection already set.
 */
function useKeptInView(
  selected: boolean,
  position: number,
): React.RefObject<HTMLDivElement | null> {
  const row = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const box = row.current;
    const list = box?.parentElement;
    if (!selected || !box || !list) return;
    const top = box.offsetTop - list.offsetTop;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (top + box.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + box.offsetHeight - list.clientHeight;
    }
  }, [selected, position]);

  return row;
}

/**
 * A row's own box, selected or not.
 *
 * Out of line because the hover rule needs the explanation more than the JSX
 * has room for: hover must never WEAKEN the selection. Written flat as
 * `'&:hover': { backgroundColor: action.hover }`, the pseudo-class wins on
 * specificity and repaints the selected row with the hover tint — measured at
 * `rgba(0,0,0,0.08)` idle against `rgba(0,0,0,0.04)` hovered, so pointing at
 * the selected row visually DESELECTED it and made it indistinguishable from
 * any other row under the cursor.
 */
function rowSx(theme: Theme, selected: boolean): SxProps<Theme> {
  const resting = selected ? theme.palette.action.selected : 'transparent';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(FLEET_ROW.gapUnits),
    padding: theme.spacing(FLEET_ROW.paddingYUnits, FLEET_ROW.paddingXUnits),
    // `1`, not `theme.shape.borderRadius / 4`. MUI's `sx` reads a NUMBER here as
    // a multiple of `theme.shape.borderRadius`, so dividing the theme value out
    // and letting `sx` multiply it back in is quadratic: measured 4px on the
    // default theme — which is why this looked right — and 36px on a host that
    // sets its own radius to 12. In a package whose whole premise is being
    // re-themed, only the multiple is portable.
    borderRadius: FLEET_ROW.radiusMultiple,
    cursor: 'pointer',
    backgroundColor: resting,
    '&:hover': {
      backgroundColor: selected ? theme.palette.action.selected : theme.palette.action.hover,
    },
  };
}

interface RowProps {
  unit: FleetUnit;
  copy: FleetMapCopy;
  freshness: FleetFreshness;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The row's DOM id, which `aria-activedescendant` points at. */
  optionId: string;
  /** Where the row sits in the re-sorted roster — see the scroll effect. */
  position: number;
  testId: string;
}

function FleetRow({
  unit,
  copy,
  freshness,
  selected,
  onSelect,
  optionId,
  position,
  testId,
}: RowProps): React.JSX.Element {
  const theme = useTheme();
  const color = freshnessColor(freshness, theme);
  const row = useKeptInView(selected, position);

  return (
    <Box
      ref={row}
      role="option"
      aria-selected={selected}
      id={optionId}
      data-testid={testId}
      data-freshness={freshness}
      onClick={() => onSelect(unit.id)}
      sx={rowSx(theme, selected)}
    >
      {/* The dot repeats what the freshness word beside it already says, so it
          is hidden rather than read twice — and colour is never the only
          carrier of the state. */}
      <Box
        aria-hidden="true"
        data-testid={`${testId}-dot`}
        sx={{
          width: FLEET_DOT.size,
          height: FLEET_DOT.size,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: color,
        }}
      />
      <RowText unit={unit} copy={copy} freshness={freshness} testId={testId} />
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

/**
 * What stands in for the roster before any unit has landed.
 *
 * `aria-hidden`, because three grey bars are not information — the panel's
 * `aria-busy` and its optional announcement carry that. The radius is the same
 * MULTIPLE a real row uses rather than a raw pixel count: `Skeleton` forwards
 * the number into `sx`, where it scales with `theme.shape.borderRadius`, so a
 * literal `4` drew 16px against the rows' 4px on the default theme and 48px
 * against 12px on a re-themed host.
 */
function FirstLoad({ testId }: { testId: string }): React.JSX.Element {
  return (
    <Stack spacing={FLEET_SKELETON.gapUnits} data-testid={`${testId}-skeleton`} aria-hidden="true">
      {Array.from({ length: FLEET_SKELETON.rows }, (_, row) => (
        <Skeleton
          key={row}
          variant="rectangular"
          height={FLEET_SKELETON.height}
          borderRadius={FLEET_SKELETON.radiusMultiple}
        />
      ))}
    </Stack>
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
  // Generated, not derived from `dataTestId`: two boards on one page filtered
  // from the same fleet would otherwise emit duplicate DOM ids and an ambiguous
  // `aria-activedescendant`. Same reason the heading uses one.
  const rowIdPrefix = React.useId();
  const optionId = (id: string): string => `${rowIdPrefix}-${id}`;

  // The selection is CONTROLLED, so it can name a unit that has since dropped
  // out of the freshness window — a courier ending their shift mid-poll. The
  // attribute must then be absent rather than pointing at an element that no
  // longer renders, which announces nothing and fails an axe audit. `mapCentre`
  // and `nextSelection` both handle the same case; this is the third place.
  const active = units.some((unit) => unit.id === selectedId) ? selectedId : null;

  // Only when there is nothing to show yet. Unmounting a populated listbox on
  // every poll destroys the focus inside it, so a dispatcher arrowing through
  // the roster is thrown back to the top of the page each time the data
  // refreshes — and the rows they were reading vanish and return.
  if (loading && units.length === 0) return <FirstLoad testId={testId} />;

  return (
    <Box
      role="listbox"
      // A single tab stop with arrow keys inside, which is the listbox pattern:
      // a dispatcher tabbing past a fleet of thirty should not have to press it
      // thirty times to reach the map.
      tabIndex={0}
      aria-label={copy.rosterLabel}
      aria-activedescendant={active ? optionId(active) : undefined}
      data-testid={`${testId}-roster`}
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(FLEET_ROSTER.gapUnits),
        overflowY: 'auto',
        minWidth: 0,
        '&:focus-visible': {
          outline: `${FLEET_ROSTER.focusRingWidth}px solid ${theme.palette.primary.main}`,
          outlineOffset: FLEET_ROSTER.focusRingOffset,
        },
      }}
    >
      {units.map((unit, index) => (
        <FleetRow
          key={unit.id}
          unit={unit}
          copy={copy}
          freshness={freshnessOf(unit.staleSeconds, laggingAfterSeconds, staleAfterSeconds)}
          selected={unit.id === active}
          onSelect={onSelect}
          optionId={optionId(unit.id)}
          position={index}
          testId={`${testId}-${unit.id}`}
        />
      ))}
    </Box>
  );
}
