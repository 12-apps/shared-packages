import Check from '@mui/icons-material/Check';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Chip from '@mui/material/Chip/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';
import { SR_ONLY_SX } from '../../form/Label/Label.styles';

import type {
  RegionMapCopy,
  RegionMapListMode,
  RegionMapListSort,
  RegionMapProps,
  RegionMapRegion,
} from './RegionMap.types';

/** The areas with a row: `listed`, defaulting to "not outside". */
export function listedRegions(
  regions: readonly RegionMapRegion[],
  sort: RegionMapListSort,
): RegionMapRegion[] {
  const listed = regions.filter((region) => region.listed ?? region.outside !== true);
  return sort === 'name' ? [...listed].sort((a, b) => a.name.localeCompare(b.name)) : listed;
}

/**
 * Every listed area as a toggle button — the keyboard's and the screen
 * reader's map, and the way to an area too small to tap. `collapsed` puts it
 * behind one button that names the count; `shown` lays it out with a heading.
 */
export function RegionMapList({
  regions,
  copy,
  mode,
  sort,
  onToggle,
  testId,
  theme,
}: {
  regions: readonly RegionMapRegion[];
  copy: RegionMapCopy;
  mode: Exclude<RegionMapListMode, 'none'>;
  sort: RegionMapListSort;
  onToggle: RegionMapProps['onToggle'];
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const listId = `${React.useId().replace(/:/g, '')}-list`;
  const rows = listedRegions(regions, sort);
  const visible = mode === 'shown' || open;
  return (
    <Box sx={{ mt: 1 }}>
      {mode === 'collapsed' && (
        <Button
          variant="text"
          size="small"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          data-testid={`${testId}-list-toggle`}
          sx={{ px: 0 }}
        >
          {open ? copy.hideList : copy.showList(rows.length)}
        </Button>
      )}
      {visible && (
        <Box id={listId} role="group" aria-label={copy.listLabel} data-testid={`${testId}-list`} sx={{ mt: 1 }}>
          {mode === 'shown' && (
            <Typography variant="caption" component="p" sx={{ fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
              {copy.listLabel}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {rows.map((region) => (
              <RegionRow
                key={region.id}
                region={region}
                states={copy.rowState}
                onToggle={onToggle}
                testId={testId}
                theme={theme}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** The focus ring every row shows from the keyboard, pressed or not. */
function focusRing(theme: Theme): { outline: string; outlineOffset: string } {
  return { outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 2) };
}

/** A row's look: inverted when pressed, holding under hover and focus. */
function rowSx(pressed: boolean, outside: boolean, theme: Theme): SxProps<Theme> {
  const ring = focusRing(theme);
  if (!pressed) {
    return { color: outside ? 'text.secondary' : 'text.primary', '&.Mui-focusVisible': ring };
  }
  const inverted = { bgcolor: 'text.primary', color: 'background.paper' };
  return {
    ...inverted,
    '& .MuiChip-icon': { color: 'inherit' },
    '&:hover': inverted,
    '&.Mui-focusVisible': { ...inverted, ...ring },
  };
}

/** The state a screen reader hears after the name, if any. */
function rowState(pressed: boolean, outside: boolean, states: RegionMapCopy['rowState']): string | null {
  if (pressed) return states.excluded;
  return outside ? states.outside : null;
}

/**
 * One area: pressed, filled and checked when excluded — never colour alone —
 * with its state spelled out for a screen reader. The inverted colours hold
 * under hover and keyboard focus, where MUI's own would wash them out.
 */
function RegionRow({
  region,
  states,
  onToggle,
  testId,
  theme,
}: {
  region: RegionMapRegion;
  states: RegionMapCopy['rowState'];
  onToggle: RegionMapProps['onToggle'];
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const pressed = region.excluded === true;
  const sx = rowSx(pressed, region.outside === true, theme);
  const state = rowState(pressed, region.outside === true, states);
  return (
    <Chip
      data-testid={`${testId}-row-${region.id}`}
      label={
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
          <span>{region.name}</span>
          {region.detail && (
            <Box component="span" sx={{ fontSize: rem(theme, 11), opacity: 0.75 }}>
              {region.detail}
            </Box>
          )}
          {state && (
            <Box component="span" sx={SR_ONLY_SX}>
              {state}
            </Box>
          )}
        </Box>
      }
      icon={pressed ? <Check fontSize="small" /> : undefined}
      variant={pressed ? 'filled' : 'outlined'}
      aria-pressed={onToggle ? pressed : undefined}
      onClick={onToggle ? () => onToggle(region.id) : undefined}
      sx={sx}
    />
  );
}
