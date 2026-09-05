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
  googleMapsApiKey?: string;
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
  googleMapsApiKey,
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
          the screen. */}
      <Box
        sx={{
          flexBasis: { md: '280px' },
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
        googleMapsApiKey={googleMapsApiKey}
        testId={testId}
      />
    </Stack>
  );
}
