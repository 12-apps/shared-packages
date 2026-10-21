'use client';

import { Box, CircularProgress, LinearProgress, Stack, SvgIcon, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { EVIDENCE_RUN_SECTIONS, type BrowserWalletResult, type EvidenceRunSection } from '@12-apps/payments-backend';

import { usePlatformCopy } from './copy-context';

/**
 * The evidence run's progress, one line per step (FUT-3755): a run takes
 * minutes — every cancel is retried while the sandbox answers 40008 — so the
 * operator sees which step is done, which one is going, and which wallets this
 * generation carries (their sheets were tapped BEFORE "generate", and the
 * buttons reset once the tokens are taken).
 *
 * The sections come from the host as the server starts each one; the card
 * never guesses one. A download-only press shows the file step alone.
 */

export type EvidencePhase = 'preparing' | 'encrypting' | 'running' | 'downloading';
export type EvidenceRunStep = 'prepare' | 'encrypt' | EvidenceRunSection | 'file';

const FULL_RUN: readonly EvidenceRunStep[] = ['prepare', 'encrypt', ...EVIDENCE_RUN_SECTIONS, 'file'];
const DOWNLOAD_ONLY: readonly EvidenceRunStep[] = ['file'];

/** The step a phase — and, while running, the server's section — is on. */
export function currentEvidenceStep(phase: EvidencePhase, section: EvidenceRunSection | null): EvidenceRunStep {
  if (phase === 'preparing') return 'prepare';
  if (phase === 'encrypting') return 'encrypt';
  if (phase === 'running') return section ?? 'PIX';
  return 'file';
}

export interface EvidenceProgressProps {
  phase: EvidencePhase;
  section: EvidenceRunSection | null;
  /** False for "download the latest recorded": nothing is run. */
  full: boolean;
  /** What the wallet sheets answered for this run; null on a download-only press. */
  walletResults: BrowserWalletResult[] | null;
}

// Material Symbols' check_circle and radio_button_unchecked, inline: the
// package takes no icons dependency (see `../checkout/icons.tsx`).
const DONE_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z';
const PENDING_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8';

/** Shape, not only colour, tells the three states apart. */
function StepMark({ state }: { state: 'done' | 'current' | 'pending' }): ReactNode {
  if (state === 'current') return <CircularProgress size={18} thickness={5} />;
  return (
    <SvgIcon fontSize="small" color={state === 'done' ? 'success' : 'disabled'}>
      <path d={state === 'done' ? DONE_PATH : PENDING_PATH} />
    </SvgIcon>
  );
}

/** Which wallets this run carries a token for, and which stay pending. */
function WalletsLine({ results }: { results: BrowserWalletResult[] }): ReactNode {
  const copy = usePlatformCopy().evidence;
  const names = copy.wallets.names;
  const included = (['GOOGLE_PAY', 'APPLE_PAY'] as const).filter((type) =>
    results.some((result) => result.type === type && result.token),
  );
  const left = (['GOOGLE_PAY', 'APPLE_PAY'] as const).filter((type) => !included.includes(type));
  return (
    <Typography variant="caption" component="p" data-testid="evidence-run-wallets">
      {copy.steps.walletsInRun(
        included.map((type) => names[type]),
        left.map((type) => names[type]),
      )}
    </Typography>
  );
}

export function EvidenceProgress({ phase, section, full, walletResults }: EvidenceProgressProps): ReactNode {
  const copy = usePlatformCopy().evidence;
  const steps = full ? FULL_RUN : DOWNLOAD_ONLY;
  const at = steps.indexOf(currentEvidenceStep(phase, section));
  return (
    <Stack spacing={1} role="status" aria-busy="true" data-testid="evidence-phase">
      <Typography variant="body2">{copy.phases[phase]}</Typography>
      <LinearProgress variant="determinate" value={(at / steps.length) * 100} aria-label={copy.steps.label} />
      {full ? (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }} data-testid="evidence-steps">
          {steps.map((step, index) => {
            const state = index < at ? 'done' : index === at ? 'current' : 'pending';
            return (
              <Stack
                key={step}
                component="li"
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', minHeight: 24 }}
                data-testid={`evidence-step-${step}`}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <StepMark state={state} />
                <Typography
                  variant="body2"
                  fontWeight={state === 'current' ? 600 : 400}
                  color={state === 'pending' ? 'text.secondary' : 'text.primary'}
                >
                  {copy.steps.names[step]}
                </Typography>
              </Stack>
            );
          })}
        </Box>
      ) : null}
      {walletResults ? <WalletsLine results={walletResults} /> : null}
    </Stack>
  );
}
