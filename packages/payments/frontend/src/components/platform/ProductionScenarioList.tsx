'use client';

import { Box, Button, Stack, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';

import { sxRem } from '../rem';
import { TAP_SX } from './ConnectEnvironmentCard';
import type { HomologacaoProductionEvidenceCopy } from './copy';
import type { ProductionCardRefundView, ProductionPixView } from './ProductionPixPanel';
import { ScenarioMark, type ScenarioMarkKind } from './ScenarioMark';

/**
 * Beside the form once a PRODUCTION run returned (FUT-4198, FUT-4322, FUT-4360;
 * prototype option A): one row per scenario saying what really happened —
 * `name · status`, and after a dash the reason — and, once PagBank refused the
 * Pix refund on every attempt, the button to try again under the list.
 *
 * The outcomes are the SERVER's (`scenarios`, read off the run's record); the
 * card never guesses one. The Pix row is drawn from the live Pix view, which
 * the card keeps polling while its refund is retried.
 */

type Scenario = 'credit' | 'debit' | 'pix' | 'googlePay' | 'applePay';

/** One scenario's outcome, as the server answers it (`EvidenceScenarioOutcome`). */
export interface ProductionScenarioOutcome {
  scenario: Scenario;
  status: 'EXECUTED' | 'FAILED' | 'PENDING';
  reason: 'EMAIL_EQUALS_MERCHANT' | 'ISSUER_DECLINED' | null;
}

type Copy = HomologacaoProductionEvidenceCopy['scenarios'];

interface Row {
  key: Scenario;
  mark: ScenarioMarkKind;
  markLabel: string;
  status: string;
  reason: string | null;
}

const ORDER: readonly Scenario[] = ['credit', 'debit', 'pix', 'googlePay', 'applePay'];

/** Minutes until `nextAt`, rounded up and never below one: "a próxima em 1 min", never 0. */
function minutesUntil(nextAt: string, now: number): number {
  return Math.max(1, Math.ceil((new Date(nextAt).getTime() - now) / 60_000));
}

/** The scenario's row from its outcome. */
function outcomeRow(outcome: ProductionScenarioOutcome, copy: Copy): Row {
  const base = { key: outcome.scenario, reason: null };
  if (outcome.status === 'EXECUTED') return { ...base, mark: 'executed', markLabel: copy.status.executed, status: copy.status.executed };
  if (outcome.status === 'PENDING') return { ...base, mark: 'pending', markLabel: copy.status.pending, status: copy.status.pending };
  return { ...base, mark: 'failed', markLabel: copy.status.failed, status: copy.status.failed, reason: reasonOf(outcome, copy) };
}

function reasonOf(outcome: ProductionScenarioOutcome, copy: Copy): string | null {
  if (outcome.reason === 'EMAIL_EQUALS_MERCHANT') return copy.reasons.emailEqualsMerchant;
  if (outcome.reason !== 'ISSUER_DECLINED') return null;
  const declined = copy.reasons.issuerDeclined;
  return outcome.scenario === 'credit' ? declined.credit : outcome.scenario === 'debit' ? declined.debit : declined.wallet;
}

/** The Pix row of a paid Pix whose refund is not done: retrying, in flight, or out of attempts. */
function refundRow(pix: ProductionPixView, copy: Copy, now: number): Row {
  const refund = pix.refund ?? null;
  const key = 'pix' as const;
  if (!refund) {
    return { key, mark: 'checking', markLabel: copy.marks.checking, status: copy.pix.REFUND_PENDING, reason: null };
  }
  if (refund.exhausted) {
    const reason = refund.refusal === 'REFUSED' ? copy.pix.refused : copy.pix.exhausted(refund.of);
    return { key, mark: 'failed', markLabel: copy.status.failed, status: copy.pix.paidNotRefunded, reason };
  }
  if (refund.nextAt === null) {
    return { key, mark: 'checking', markLabel: copy.marks.checking, status: copy.pix.REFUND_PENDING, reason: null };
  }
  const reason = copy.pix.notYet(refund.attempt, refund.of, minutesUntil(refund.nextAt, now));
  return { key, mark: 'retrying', markLabel: copy.marks.retrying, status: copy.pix.paid, reason };
}

/** A card's row while its refund is not done (T-18): retrying with the next attempt, or out of attempts. */
function cardRefundRow(card: ProductionCardRefundView, copy: Copy, now: number): Row {
  const key = card.scenario;
  if (card.exhausted) {
    const reason = card.refusal === 'REFUSED' ? copy.pix.refused : copy.pix.exhausted(card.of);
    return { key, mark: 'failed', markLabel: copy.status.failed, status: copy.pix.paidNotRefunded, reason };
  }
  if (card.nextAt === null) return { key, mark: 'checking', markLabel: copy.marks.checking, status: copy.pix.refunding, reason: null };
  const reason = copy.pix.notYet(card.attempt, card.of, minutesUntil(card.nextAt, now));
  return { key, mark: 'retrying', markLabel: copy.marks.retrying, status: copy.pix.refunding, reason };
}

/** The Pix row from the live view: where it stands now, which the outcomes cannot say. */
function pixRow(pix: ProductionPixView, copy: Copy, checking: boolean, now: number): Row | null {
  const key = 'pix' as const;
  if (pix.state === 'NONE') return null;
  if (pix.state === 'REFUND_PENDING') return refundRow(pix, copy, now);
  if (pix.state === 'REFUNDED') return { key, mark: 'executed', markLabel: copy.status.executed, status: copy.pix.REFUNDED, reason: null };
  const waiting = pix.state === 'AWAITING_PAYMENT' && checking;
  return {
    key,
    mark: waiting ? 'checking' : 'pending',
    markLabel: waiting ? copy.marks.checking : copy.status.pending,
    status: copy.pix[pix.state],
    reason: null,
  };
}

function rowsOf(scenarios: readonly ProductionScenarioOutcome[] | null, pix: ProductionPixView | null, checking: boolean, copy: Copy, now: number): Row[] {
  const live = pix ? pixRow(pix, copy, checking, now) : null;
  const rows = ORDER.flatMap((key): Row[] => {
    if (key === 'pix') {
      const outcome = scenarios?.find((candidate) => candidate.scenario === 'pix');
      return live ? [live] : outcome ? [outcomeRow(outcome, copy)] : [];
    }
    // A card whose cancel did not go back: where its refund stands, which the outcome cannot say (C33).
    const card = pix?.cards?.find((candidate) => candidate.scenario === key);
    if (card) return [cardRefundRow(card, copy, now)];
    const outcome = scenarios?.find((candidate) => candidate.scenario === key);
    return outcome ? [outcomeRow(outcome, copy)] : [];
  });
  return rows;
}

/** A countdown is on screen: the Pix's next attempt, or a card's. */
function countingDown(pix: ProductionPixView | null): boolean {
  if (pix?.state === 'REFUND_PENDING' && pix.refund?.nextAt != null) return true;
  return pix?.cards?.some((card) => card.nextAt !== null) ?? false;
}

/** Which press the list offers: the Pix's once its attempts ran out, else a card's (C33), else none. */
function pressOf(pix: ProductionPixView | null): 'PIX' | 'CARD' | null {
  if (pix?.state === 'REFUND_PENDING') return pix.refund?.exhausted === true ? 'PIX' : null;
  return pix?.cards?.some((card) => card.exhausted) ? 'CARD' : null;
}

/** The clock, redrawn every so often while a countdown is on screen. */
function useNow(running: boolean): number {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => redraw((tick) => tick + 1), 15_000);
    return () => clearInterval(timer);
  }, [running]);
  return Date.now();
}

export function ProductionScenarioList({
  scenarios,
  pix,
  checking,
  copy,
  onRetryRefund,
  retrying,
}: {
  /** The run's outcomes; null while only the Pix is known (a reload before the run answered). */
  scenarios: readonly ProductionScenarioOutcome[] | null;
  pix: ProductionPixView | null;
  /** False once the card stopped checking the Pix on its own. */
  checking: boolean;
  copy: Copy;
  /** "Tentar estornar o Pix de novo": asks the server for a new series of attempts. */
  onRetryRefund: () => void;
  /** The press is in flight: the button waits. */
  retrying: boolean;
}): ReactNode {
  const counting = countingDown(pix);
  const rows = rowsOf(scenarios, pix, checking, copy, useNow(counting));
  if (rows.length === 0) return null;
  const press = pressOf(pix);
  const exhausted = press === 'PIX';
  const cardExhausted = press === 'CARD';
  return (
    <Stack spacing={1} data-testid="production-scenarios">
      <Typography variant="body2" fontWeight={600}>
        {copy.label}
      </Typography>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
        {rows.map((row) => (
          // The mark stays on the first line when a long reason wraps.
          <Stack key={row.key} component="li" direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} data-testid={`production-scenario-${row.key}`}>
            <ScenarioMark kind={row.mark} label={row.markLabel} />
            <Typography variant="body2" sx={{ minWidth: 0 }}>
              {copy.names[row.key]}
              <Typography component="span" variant="body2" color="text.secondary">
                {' · '}
                {row.status}
                {row.reason ? ` — ${row.reason}` : ''}
              </Typography>
            </Typography>
          </Stack>
        ))}
      </Box>
      {exhausted || cardExhausted ? (
        <Button
          variant="outlined"
          onClick={onRetryRefund}
          disabled={retrying}
          data-testid={cardExhausted ? 'production-retry-card-refund' : 'production-retry-refund'}
          sx={{
            ...TAP_SX,
            alignSelf: 'flex-start',
            minHeight: sxRem(40),
            borderRadius: sxRem(8),
            textTransform: 'none',
            fontWeight: 600,
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderColor: 'text.primary',
          }}
        >
          {cardExhausted ? copy.retryCardRefund : copy.retryRefund}
        </Button>
      ) : null}
    </Stack>
  );
}
