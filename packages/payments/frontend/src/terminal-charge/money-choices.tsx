'use client';

import { Alert, AlertTitle, Paper } from '@mui/material';
import { useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';

import { ActConfirm } from './act-confirm';
import { ActionButton, ChoiceRow } from './choice-actions';
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
 *
 * The warning is the theme's warning `Alert` (amber, never red: nothing
 * failed), and the choices sit under it on the paper, where every rank of
 * button reads at the theme's own contrast — never on the warning's fill.
 */

/** The question in a warning, and its answers on the paper below it. */
function Band({ dataTestId, band, children }: { dataTestId: string; band: RefObject<HTMLDivElement | null>; children: ReactNode }): JSX.Element {
  return (
    <Paper ref={band} variant="outlined" data-testid={dataTestId} sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, borderColor: 'warning.main' }}>
      {children}
    </Paper>
  );
}

/**
 * The act chosen in a band, and where focus goes: the confirm step takes it
 * (its reason field), and "back" returns it to the button that was chosen, so
 * a keyboard never starts again from the top of the page.
 */
function useChoice<A extends string>(dataTestId: string) {
  const [chosen, setChosen] = useState<A | null>(null);
  const returnTo = useRef<A | null>(null);
  const band = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (chosen !== null || returnTo.current === null) return;
    band.current?.querySelector<HTMLElement>(`[data-testid="${dataTestId}-${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [chosen, dataTestId]);
  const back = (): void => {
    returnTo.current = chosen;
    setChosen(null);
  };
  return { chosen, choose: setChosen, back, band };
}

function Question({ title, lede }: { title: string; lede: string }): JSX.Element {
  return (
    <Alert severity="warning">
      <AlertTitle>{title}</AlertTitle>
      {lede}
    </Alert>
  );
}

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
  const { chosen, choose: setChosen, back, band } = useChoice<ReceivedTwiceAct>(dataTestId);
  const titleOf = (act: ReceivedTwiceAct): string => (act === 'give-back' ? copy.giveBack(money) : copy.refundCard);
  return (
    <Band dataTestId={dataTestId} band={band}>
      {chosen === null ? (
        <>
          <Question title={copy.title(money)} lede={copy.lede} />
          <ChoiceRow label={copy.title(money)}>
            <ActionButton rank="primary" onClick={() => setChosen('give-back')} data-testid={`${dataTestId}-give-back`}>
              {copy.giveBack(money)}
            </ActionButton>
            <ActionButton rank="secondary" onClick={() => setChosen('refund-card')} data-testid={`${dataTestId}-refund-card`}>
              {copy.refundCard}
            </ActionButton>
          </ChoiceRow>
        </>
      ) : (
        <ActConfirm
          title={titleOf(chosen)}
          copy={confirmCopy}
          onSend={(input) => onAct(chosen, input)}
          onDone={() => onDone(chosen)}
          onBack={back}
          dataTestId={`${dataTestId}-confirm`}
        />
      )}
    </Band>
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
  const { chosen, choose: setChosen, back, band } = useChoice<OverCaptureAct>(dataTestId);
  const labels: Record<OverCaptureAct, string> = {
    change: copy.change(excess),
    credit: buyer === null ? '' : copy.credit(excess, buyer),
    'refund-and-charge': copy.refundAndCharge(refund, charge),
  };
  if (chosen !== null) {
    return (
      <Band dataTestId={dataTestId} band={band}>
        <ActConfirm
          title={labels[chosen]}
          copy={confirmCopy}
          onSend={(input) => onAct(chosen, input)}
          onDone={() => onDone(chosen)}
          onBack={back}
          dataTestId={`${dataTestId}-confirm`}
        />
      </Band>
    );
  }
  return (
    <Band dataTestId={dataTestId} band={band}>
      <Question title={copy.title(excess)} lede={copy.lede} />
      <ChoiceRow label={copy.title(excess)}>
        <ActionButton rank="primary" onClick={() => setChosen('change')} data-testid={`${dataTestId}-change`}>
          {labels.change}
        </ActionButton>
        {buyer === null ? null : (
          <ActionButton rank="secondary" onClick={() => setChosen('credit')} data-testid={`${dataTestId}-credit`}>
            {labels.credit}
          </ActionButton>
        )}
        <ActionButton rank="tertiary" onClick={() => setChosen('refund-and-charge')} data-testid={`${dataTestId}-refund-and-charge`}>
          {labels['refund-and-charge']}
        </ActionButton>
      </ChoiceRow>
    </Band>
  );
}
