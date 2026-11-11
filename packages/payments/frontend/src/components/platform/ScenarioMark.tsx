'use client';

import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';

import { sxRem } from '../rem';

/**
 * The mark at the start of a scenario row (FUT-4322, prototype option A): its
 * SHAPE says the outcome, not its colour alone, and each is an image named by
 * its meaning so a screen reader hears it too.
 *
 * - `executed`: a filled circle in the INK with a check — never green: a ✓ sits
 *   beside a red ✗ and the staff screens' primary may itself be red;
 * - `failed`: a filled red circle with a cross;
 * - `retrying`: an amber ring with clock hands (the Pix refund is being retried);
 * - `pending`: a grey ring;
 * - `checking`: the spinner, while the card still checks the Pix on its own.
 */

export type ScenarioMarkKind = 'executed' | 'failed' | 'retrying' | 'pending' | 'checking';

const CHECK = 'M6 10.5l2.5 2.5L14 7.5';
const CROSS = 'M7 7l6 6M13 7l-6 6';
const HANDS = 'M10 5.5V10l3 2';

function Glyph({ kind }: { kind: Exclude<ScenarioMarkKind, 'checking'> }): ReactNode {
  const hairline = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round' } as const;
  if (kind === 'executed' || kind === 'failed') {
    return (
      <>
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <Box component="path" d={kind === 'executed' ? CHECK : CROSS} sx={{ ...hairline, stroke: (theme) => theme.palette.background.paper }} />
      </>
    );
  }
  return (
    <>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      {kind === 'retrying' ? <path d={HANDS} stroke="currentColor" {...hairline} /> : null}
    </>
  );
}

const COLOUR: Record<Exclude<ScenarioMarkKind, 'checking'>, string> = {
  executed: 'text.primary',
  failed: 'error.main',
  retrying: 'warning.dark',
  pending: 'text.disabled',
};

export function ScenarioMark({ kind, label }: { kind: ScenarioMarkKind; label: string }): ReactNode {
  const box = { width: sxRem(20), height: sxRem(20), flexShrink: 0, display: 'grid', placeItems: 'center' } as const;
  if (kind === 'checking') {
    return (
      <Box role="img" aria-label={label} sx={box}>
        <CircularProgress size={18} thickness={5} color="inherit" sx={{ color: 'text.primary' }} />
      </Box>
    );
  }
  return (
    <Box component="svg" viewBox="0 0 20 20" role="img" aria-label={label} sx={{ ...box, display: 'block', color: COLOUR[kind] }}>
      <Glyph kind={kind} />
    </Box>
  );
}
