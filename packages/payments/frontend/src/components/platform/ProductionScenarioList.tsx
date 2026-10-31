'use client';

import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { HomologacaoProductionEvidenceCopy } from './copy';
import { StepMark } from './HomologacaoEvidenceProgress';
import type { ProductionPixView } from './ProductionPixPanel';

/**
 * Beside the form once a PRODUCTION run returned (FUT-4198, option A+C): one
 * line per scenario. The card never guesses an outcome — an approved or
 * declined charge is the file's to say — so a scenario the run sent reads
 * "recorded", one it could not send reads "pending", and the Pix reads where
 * the server says it stands.
 */

/** What this browser sent to the run: the credit card always, the rest only when it had one. */
export interface ProductionScenariosSent {
  debit: boolean;
  googlePay: boolean;
  applePay: boolean;
}

type Mark = 'done' | 'current' | 'pending';

/** A spinner only while the card is still checking on its own: once it stopped, nothing is moving. */
function pixMark(state: ProductionPixView['state'], checking: boolean): Mark {
  if (state === 'REFUNDED') return 'done';
  const open = state === 'AWAITING_PAYMENT' || state === 'REFUND_PENDING';
  return open && checking ? 'current' : 'pending';
}

export function ProductionScenarioList({
  sent,
  pix,
  checking,
  copy,
}: {
  /** Null after a reload: only the Pix is known then. */
  sent: ProductionScenariosSent | null;
  pix: ProductionPixView | null;
  /** False once the card stopped checking the Pix on its own. */
  checking: boolean;
  copy: HomologacaoProductionEvidenceCopy['scenarios'];
}): ReactNode {
  const sentLine = (key: 'credit' | 'debit' | 'googlePay' | 'applePay', was: boolean) => ({
    key,
    mark: (was ? 'done' : 'pending') as Mark,
    status: was ? copy.recorded : copy.pending,
  });
  const pixLine = pix && pix.state !== 'NONE' ? [{ key: 'pix' as const, mark: pixMark(pix.state, checking), status: copy.pix[pix.state] }] : [];
  const lines = sent
    ? [sentLine('credit', true), sentLine('debit', sent.debit), ...pixLine, sentLine('googlePay', sent.googlePay), sentLine('applePay', sent.applePay)]
    : pixLine;
  if (lines.length === 0) return null;
  return (
    <Stack spacing={1} data-testid="production-scenarios">
      <Typography variant="body2" fontWeight={600}>
        {copy.label}
      </Typography>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
        {lines.map((line) => (
          <Stack key={line.key} component="li" direction="row" spacing={1} sx={{ alignItems: 'center' }} data-testid={`production-scenario-${line.key}`}>
            <StepMark state={line.mark} />
            <Typography variant="body2">
              {copy.names[line.key]}
              <Typography component="span" variant="body2" color="text.secondary">
                {' · '}
                {line.status}
              </Typography>
            </Typography>
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
