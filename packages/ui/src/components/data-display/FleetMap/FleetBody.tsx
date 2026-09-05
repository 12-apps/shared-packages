import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import React from 'react';

import { FleetCanvas } from './FleetCanvas';
import type { FleetMapState } from './FleetMap.hooks';
import type { FleetMapCopy } from './FleetMap.types';
import { FleetRoster } from './FleetRoster';

export interface FleetBodyProps
  extends Pick<FleetMapState, 'ordered' | 'centre' | 'markers' | 'select' | 'onKeyDown'> {
  copy: FleetMapCopy;
  selectedId: string | null | undefined;
  laggingAfterSeconds: number;
  staleAfterSeconds: number;
  height: string;
  loading: boolean;
  testId: string;
}

/**
 * The two halves side by side: the roster that reads the fleet, and the map.
 *
 * A component rather than JSX inside {@link import('./FleetMap').FleetMap}
 * because the layout is where every responsive decision lives, and keeping it
 * here is what leaves the exported component short enough to read in one
 * screen — which the complexity ledger enforces rather than merely suggests.
 */
export function FleetBody({
  ordered,
  centre,
  markers,
  select,
  onKeyDown,
  copy,
  selectedId,
  laggingAfterSeconds,
  staleAfterSeconds,
  height,
  loading,
  testId,
}: FleetBodyProps): React.JSX.Element {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      sx={{ alignItems: 'stretch', minWidth: 0 }}
    >
      {/* The roster reads first on a phone and sits beside the map from md up.
          It keeps a ceiling so thirty units scroll rather than push the map off
          the screen.

          It also WIDENS with the viewport rather than staying at its md width.
          Held at 280px, a desktop gave the map 1600px for three pins while the
          roster stayed too narrow for its own meta line — `Lagging · 2 min ago ·
          ±180 m` wrapped, at 1920px of all widths. The rungs below are the ones
          the six-width pass was taken at. */}
      <Box
        sx={{
          flexBasis: { md: '280px', lg: '320px', xl: '380px' },
          flexShrink: 0,
          minWidth: 0,
          maxHeight: height,
          display: 'flex',
        }}
      >
        <FleetRoster
          units={ordered}
          copy={copy}
          selectedId={selectedId}
          onSelect={select}
          laggingAfterSeconds={laggingAfterSeconds}
          staleAfterSeconds={staleAfterSeconds}
          loading={loading}
          testId={testId}
          onKeyDown={onKeyDown}
        />
      </Box>
      <FleetCanvas
        copy={copy}
        centre={centre}
        markers={markers}
        height={height}
        testId={testId}
      />
    </Stack>
  );
}
