'use client';

import { Box, Button, Stack } from '@mui/material';
import { useState, type JSX } from 'react';

import { ActConfirm } from './act-confirm';
import type { ConfirmedActAnswer } from './confirmed-act';
import type { ActConfirmCopy, OverCaptureCopy, ReceivedTwiceCopy } from './copy';

/**
 * The two decisions about money the terminal took that does not fit the sale,
 * each act confirmed by a reason and the person's PIN and sent at once:
 *
 * - {@link ReceivedTwiceBand} (State 4): the terminal approved a leg already
 *   received another way. The buyer paid twice; the operator gives one back.
 *   The band stays until one is chosen.
 * - {@link OverCaptureChoice} (State 5): the captures passed the total (an
 *   edit lowered it, which is never refused). Change in cash (primary), store
 *   credit (only with a buyer), or refund and charge again (a text button).
 *
 * The host sends each act through its own permission and PIN gate.
 */

const BAND_SX = { p: 2, borderRadius: 2, border: 1.5, borderColor: 'warning.main', bgcolor: 'warning.light' } as const;

export type ReceivedTwiceAct = 'give-back' | 'refund-card';

export interface ReceivedTwiceBandProps {
  /** The capture's amount, formatted by the host. */
  readonly money: string;
  readonly copy: ReceivedTwiceCopy;
  readonly confirmCopy: ActConfirmCopy;
  readonly onAct: (act: ReceivedTwiceAct, input: { reason: string; pin: string }) => Promise<ConfirmedActAnswer>;
  /** The act was done: the band may go. */
  readonly onDone: (act: ReceivedTwiceAct) => void;
  readonly dataTestId?: string;
}

export function ReceivedTwiceBand({ money, copy, confirmCopy, onAct, onDone, dataTestId = 'terminal-received-twice' }: ReceivedTwiceBandProps): JSX.Element {
  const [chosen, setChosen] = useState<ReceivedTwiceAct | null>(null);
  const titleOf = (act: ReceivedTwiceAct): string => (act === 'give-back' ? copy.giveBack(money) : copy.refundCard);
  return (
    <Box role="alert" sx={BAND_SX} data-testid={dataTestId}>
      {chosen === null ? (
        <Stack spacing={1}>
          <Box component="p" sx={{ m: 0, fontWeight: 700 }}>
            {copy.title(money)}
          </Box>
          <Box component="p" sx={{ m: 0 }}>
            {copy.lede}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => setChosen('give-back')} data-testid={`${dataTestId}-give-back`}>
              {copy.giveBack(money)}
            </Button>
            <Button variant="outlined" onClick={() => setChosen('refund-card')} data-testid={`${dataTestId}-refund-card`}>
              {copy.refundCard}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <ActConfirm
          title={titleOf(chosen)}
          copy={confirmCopy}
          onSend={(input) => onAct(chosen, input)}
          onDone={() => onDone(chosen)}
          onBack={() => setChosen(null)}
          dataTestId={`${dataTestId}-confirm`}
        />
      )}
    </Box>
  );
}

export type OverCaptureAct = 'change' | 'credit' | 'refund-and-charge';

export interface OverCaptureChoiceProps {
  /** The excess, the capture to refund and the total to charge again, each formatted by the host. */
  readonly excess: string;
  readonly refund: string;
  readonly charge: string;
  /** The buyer's name. Store credit is offered only for an identified buyer. */
  readonly buyer: string | null;
  readonly copy: OverCaptureCopy;
  readonly confirmCopy: ActConfirmCopy;
  readonly onAct: (act: OverCaptureAct, input: { reason: string; pin: string }) => Promise<ConfirmedActAnswer>;
  readonly onDone: (act: OverCaptureAct) => void;
  readonly dataTestId?: string;
}

export function OverCaptureChoice(props: OverCaptureChoiceProps): JSX.Element {
  const { excess, refund, charge, buyer, copy, confirmCopy, onAct, onDone, dataTestId = 'terminal-over-capture' } = props;
  const [chosen, setChosen] = useState<OverCaptureAct | null>(null);
  const labels: Record<OverCaptureAct, string> = {
    change: copy.change(excess),
    credit: buyer === null ? '' : copy.credit(excess, buyer),
    'refund-and-charge': copy.refundAndCharge(refund, charge),
  };
  if (chosen !== null) {
    return (
      <Box sx={BAND_SX} data-testid={dataTestId}>
        <ActConfirm
          title={labels[chosen]}
          copy={confirmCopy}
          onSend={(input) => onAct(chosen, input)}
          onDone={() => onDone(chosen)}
          onBack={() => setChosen(null)}
          dataTestId={`${dataTestId}-confirm`}
        />
      </Box>
    );
  }
  return (
    <Box role="alert" sx={BAND_SX} data-testid={dataTestId}>
      <Stack spacing={1}>
        <Box component="p" sx={{ m: 0, fontWeight: 700 }}>
          {copy.title(excess)}
        </Box>
        <Box component="p" sx={{ m: 0 }}>
          {copy.lede}
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => setChosen('change')} data-testid={`${dataTestId}-change`}>
            {labels.change}
          </Button>
          {buyer === null ? null : (
            <Button variant="outlined" onClick={() => setChosen('credit')} data-testid={`${dataTestId}-credit`}>
              {labels.credit}
            </Button>
          )}
        </Stack>
        <Box>
          <Button variant="text" onClick={() => setChosen('refund-and-charge')} data-testid={`${dataTestId}-refund-and-charge`}>
            {labels['refund-and-charge']}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
