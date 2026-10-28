import Check from '@mui/icons-material/Check';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Chip from '@mui/material/Chip/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import type { RegionMapCopy, RegionMapListMode, RegionMapProps, RegionMapRegion } from './RegionMap.types';

/**
 * Every area as a toggle button — the keyboard's and the screen reader's map,
 * and the way to an area too small to tap. `collapsed` puts it behind one
 * button that names the count; `shown` lays it out with a heading.
 */
export function RegionMapList({
  regions,
  copy,
  mode,
  onToggle,
  testId,
  theme,
}: {
  regions: readonly RegionMapRegion[];
  copy: RegionMapCopy;
  mode: Exclude<RegionMapListMode, 'none'>;
  onToggle: RegionMapProps['onToggle'];
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const listId = `${testId}-list`;
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
          {open ? copy.hideList : copy.showList(regions.length)}
        </Button>
      )}
      {visible && (
        <Box id={listId} role="group" aria-label={copy.listLabel} data-testid={listId} sx={{ mt: 1 }}>
          {mode === 'shown' && (
            <Typography variant="caption" component="p" sx={{ fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
              {copy.listLabel}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {regions.map((region) => (
              <RegionRow key={region.id} region={region} onToggle={onToggle} testId={testId} theme={theme} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** One area: pressed, filled and checked when excluded — never colour alone. */
function RegionRow({
  region,
  onToggle,
  testId,
  theme,
}: {
  region: RegionMapRegion;
  onToggle: RegionMapProps['onToggle'];
  testId: string;
  theme: Theme;
}): React.JSX.Element {
  const pressed = region.excluded === true;
  const pressedSx = {
    bgcolor: 'text.primary',
    color: 'background.paper',
    '& .MuiChip-icon': { color: 'inherit' },
    '&:hover': { bgcolor: 'text.secondary' },
  };
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
        </Box>
      }
      icon={pressed ? <Check fontSize="small" /> : undefined}
      variant={pressed ? 'filled' : 'outlined'}
      aria-pressed={onToggle ? pressed : undefined}
      onClick={onToggle ? () => onToggle(region.id) : undefined}
      sx={pressed ? pressedSx : { color: region.outside ? 'text.secondary' : 'text.primary' }}
    />
  );
}
