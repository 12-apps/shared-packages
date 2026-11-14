'use client';

import { Box, Button, Stack, Typography } from '@mui/material';
import { useState, type JSX } from 'react';

import { currentIndex, isLive, partOf, readiness, remainingAfter } from './charge-flow';
import type { ChargeRun } from './charge-run';
import type { TerminalWaitCopy } from './copy';
import type { ChargeFlow, FlowLeg, LegStatus } from './flow-types';

/**
 * The wait for the leg on the terminal, inside the host's charge screen: where
 * it is charged, its amount, where it stands, and the ways out the leg offers
 * (`FlowLeg.exits`) — cancel on the terminal, send again, another tender.
 * There is always a way out and no timeout. The split's other legs are listed beside it.
 */
export interface TerminalWaitProps {
  readonly flow: ChargeFlow;
  readonly run: ChargeRun;
  /** The terminal's provider, as the host names it. */
  readonly provider: string;
  /** The store's other tenders for "another tender": id and name. */
  readonly tenders: readonly { readonly id: string; readonly name: string }[];
  readonly tenderName: (tender: string) => string;
  readonly money: (cents: number) => string;
  /** The leg's terminal is off the network now. */
  readonly away?: boolean;
  readonly copy: TerminalWaitCopy;
  readonly dataTestId?: string;
}

interface Said {
  readonly title: string;
  readonly sub: string | null;
  readonly warn: boolean;
}

const say = (title: string, sub: string | null = null, warn = false): Said => ({ title, sub, warn });

const WORDS: Readonly<Record<LegStatus, (copy: TerminalWaitCopy, leg: FlowLeg, money: string) => Said>> = {
  send: (copy) => say(copy.sending),
  pushing: (copy) => say(copy.sending),
  queued: (copy) => say(copy.sending),
  waiting: (copy, leg) => (leg.tender === 'PIX' ? say(copy.waitingPix, copy.waitingPixSub) : say(copy.waiting, copy.waitingSub)),
  processing: (copy) => say(copy.processing, copy.processingSub),
  cancelling: (copy) => say(copy.cancelling),
  declined: (copy) => say(copy.declined, copy.declinedSub, true),
  cancelled: (copy) => say(copy.cancelled, copy.cancelledSub, true),
  unknown: (copy) => say(copy.unknown, copy.unknownSub, true),
  refused: (copy, leg) =>
    say(copy.refused[leg.refusal ?? ''] ?? copy.refused.NOT_CONNECTED ?? '', leg.refusal === 'BUSY' ? copy.busySub : copy.refusedSub, true),
  unbound: (copy) => say(copy.unbound, copy.unboundSub, true),
  conflict: (copy) => say(copy.conflict, copy.conflictSub, true),
  cash: (copy, _leg, money) => say(copy.cash(money), copy.cashSub),
  local: () => say(''),
  approved: () => say(''),
};

function saidOf(flow: ChargeFlow, leg: FlowLeg, copy: TerminalWaitCopy, money: string, away: boolean): Said {
  if (readiness(flow) === 'waiting-link') return say(copy.waitingLink, copy.waitingLinkSub);
  if (away && (leg.status === 'waiting' || leg.status === 'processing')) return say(copy.away, copy.awaySub);
  return WORDS[leg.status](copy, leg, money);
}

const BUTTON_SX = { minHeight: 48, textTransform: 'none' } as const;

/** The leg's ways out, as buttons; "another tender" opens the store's tenders. */
function LegExits(props: TerminalWaitProps & { leg: FlowLeg }): JSX.Element | null {
  const { leg, run, copy, tenders, money, dataTestId = 'terminal-wait' } = props;
  const [choosing, setChoosing] = useState(false);
  if (leg.exits.length === 0 && leg.status !== 'cash') return null;
  const buttons: Record<string, () => JSX.Element> = {
    cancel: () => button('cancel', copy.cancel, () => run.cancel(), 'outlined'),
    resend: () => button('resend', copy.resend, () => run.resend(), 'contained'),
    'other-tender': () => button('other', copy.other, () => setChoosing((open) => !open), 'outlined'),
  };
  function button(id: string, label: string, onClick: () => void, variant: 'contained' | 'outlined'): JSX.Element {
    return (
      <Button key={id} variant={variant} onClick={onClick} data-testid={`${dataTestId}-${id}`} sx={BUTTON_SX}>
        {label}
      </Button>
    );
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {leg.status === 'cash' ? button('cash', copy.cashReceived(money(leg.amountCents)), () => run.cashReceived(), 'contained') : null}
        {leg.exits.map((exit) => buttons[exit]?.() ?? null)}
      </Stack>
      {choosing ? (
        <Box role="group" aria-label={copy.otherLabel} sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
          {tenders.map((tender) => (
            <Button key={tender.id} variant="outlined" onClick={() => run.other(tender.id)} data-testid={`${dataTestId}-other-${tender.id}`} sx={BUTTON_SX}>
              {tender.name}
            </Button>
          ))}
        </Box>
      ) : null}
    </Stack>
  );
}

/** The split's other legs, one line each. */
function LegList({ flow, current, copy, tenderName, money }: { flow: ChargeFlow; current: number; copy: TerminalWaitCopy; tenderName: (tender: string) => string; money: (cents: number) => string }): JSX.Element | null {
  const others = flow.legs.map((leg, index) => ({ leg, index })).filter(({ index }) => index !== current);
  if (others.length === 0) return null;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {others.map(({ leg, index }) => {
        const name = tenderName(leg.tender);
        const done = leg.status === 'approved';
        return (
          <Box component="li" key={index} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, px: 1.5, py: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <span>{done ? copy.doneLine(name) : name}</span>
            <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {money(leg.amountCents)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function TerminalWait(props: TerminalWaitProps): JSX.Element {
  const { flow, run, provider, tenderName, money, away = false, copy, dataTestId = 'terminal-wait' } = props;
  const index = currentIndex(flow);
  const leg = flow.legs[index];
  if (leg === undefined) {
    return (
      <Stack spacing={1.5} data-testid={dataTestId} data-state="settling" role="status">
        <LegList flow={flow} current={-1} copy={copy} tenderName={tenderName} money={money} />
        <Typography component="p" sx={{ fontWeight: 600 }}>
          {copy.settling}
        </Typography>
      </Stack>
    );
  }
  const said = saidOf(flow, leg, copy, money(leg.amountCents), away);
  const { part, parts } = partOf(flow, index);
  const remaining = remainingAfter(flow, index);
  return (
    <Stack spacing={1.5} data-testid={dataTestId} data-state={leg.status}>
      <Stack spacing={0.75} sx={{ p: 2, borderRadius: 3, border: 1.5, borderColor: isLive(leg) ? 'primary.main' : said.warn ? 'warning.main' : 'divider' }}>
        {parts > 1 ? (
          <Typography variant="caption" component="p" sx={{ fontWeight: 600 }} data-testid={`${dataTestId}-part`}>
            {remaining > 0 ? `${copy.part(part, parts)} · ${copy.after(money(remaining))}` : copy.part(part, parts)}
          </Typography>
        ) : null}
        <Typography variant="body2" component="p" color="text.secondary">
          {copy.where(provider, tenderName(leg.tender))}
        </Typography>
        <Typography component="p" sx={{ fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }} data-testid={`${dataTestId}-amount`}>
          {money(leg.amountCents)}
        </Typography>
        <Box role="status" aria-live="polite">
          <Typography component="p" sx={{ fontSize: '1.25rem', fontWeight: 700, color: said.warn ? 'warning.dark' : 'text.primary' }} data-testid={`${dataTestId}-title`}>
            {said.title}
          </Typography>
          {said.sub === null ? null : (
            <Typography variant="body2" component="p" color="text.secondary">
              {said.sub}
            </Typography>
          )}
        </Box>
      </Stack>
      <LegExits key={`${index}:${leg.status}`} {...props} leg={leg} />
      {flow.pending !== null && flow.pending.cancellable ? (
        <Button variant="outlined" onClick={() => run.cancelPending()} data-testid={`${dataTestId}-cancel-pending`} sx={BUTTON_SX}>
          {copy.cancelPending(money(flow.pending.amountCents))}
        </Button>
      ) : null}
      <LegList flow={flow} current={index} copy={copy} tenderName={tenderName} money={money} />
    </Stack>
  );
}
