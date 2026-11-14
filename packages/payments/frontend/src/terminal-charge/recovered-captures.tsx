'use client';

import { Box, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, type JSX } from 'react';

import type { RecoveredCopy } from './copy';
import { preselectRecovered, type HeldCapture } from './held-captures';

/**
 * Money the terminal took that no sale holds, offered inside the charge
 * screen on load (State 3): "received on the terminal, no sale", with the
 * capture that fits what is still due already ticked, so the buyer is not
 * charged again and no extra tap is asked. Codes the station holds as typed
 * captures are left out: they are another screen's question.
 *
 * Controlled: the host keeps the ticked codes and counts them toward the
 * total. The preselection is applied when the list arrives and again whenever
 * the amount due changes (an edit), never on a mere re-render; on open, a
 * selection the host already holds is kept.
 */
export interface RecoveredCapturesProps {
  readonly captures: readonly HeldCapture[];
  readonly dueCents: number;
  readonly typedCodes: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly onChange: (codes: string[]) => void;
  readonly copy: RecoveredCopy;
  readonly money: (cents: number) => string;
  /** A capture's time, formatted by the host. */
  readonly time: (iso: string) => string;
  readonly methodName: (method: string) => string;
  readonly dataTestId?: string;
}

export function RecoveredCaptures({
  captures,
  dueCents,
  typedCodes,
  selected,
  onChange,
  copy,
  money,
  time,
  methodName,
  dataTestId = 'terminal-recovered',
}: RecoveredCapturesProps): JSX.Element | null {
  const listed = useMemo(() => captures.filter((capture) => !typedCodes.has(capture.transactionCode)), [captures, typedCodes]);
  // The amount due the tick was last chosen for: a new amount due (an edit) ticks again; a re-render does not.
  const tickedFor = useRef<number | null>(null);
  useEffect(() => {
    if (listed.length === 0 || tickedFor.current === dueCents) return;
    const first = tickedFor.current === null;
    tickedFor.current = dueCents;
    // On open, a selection the host already holds is kept.
    if (first && selected.length > 0) return;
    onChange(preselectRecovered(listed, dueCents, typedCodes));
  }, [listed, dueCents, typedCodes, selected.length, onChange]);

  if (listed.length === 0) return null;
  const toggle = (code: string): void =>
    onChange(selected.includes(code) ? selected.filter((one) => one !== code) : [...selected, code]);
  return (
    <Box data-testid={dataTestId} sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
      <Typography component="p" sx={{ fontWeight: 700 }}>
        {copy.title}
      </Typography>
      <Typography variant="body2" component="p" color="text.secondary">
        {copy.lede}
      </Typography>
      <Stack>
        {listed.map((capture) => (
          <Box key={capture.transactionCode} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selected.includes(capture.transactionCode)}
                  onChange={() => toggle(capture.transactionCode)}
                  data-testid={`${dataTestId}-${capture.transactionCode}`}
                />
              }
              label={copy.line(methodName(capture.kind), time(capture.capturedAt))}
            />
            <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }} data-testid={`${dataTestId}-${capture.transactionCode}-amount`}>
              {money(capture.amountCents)}
            </Box>
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" component="p" color="text.secondary">
        {copy.footnote}
      </Typography>
    </Box>
  );
}
