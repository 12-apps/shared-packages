'use client';

import { Box, CircularProgress, LinearProgress, Stack, SvgIcon, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { BrowserWalletResult, EvidenceRunSection } from '@12-apps/payments-backend';

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

/**
 * What a step that already ran gave (FUT-5519), worded by the host: the
 * production card marks each step with its own result, so a step that failed
 * never reads as done.
 */
export interface EvidenceStepResult {
  kind: 'executed' | 'failed' | 'pending';
  /** The result's word, also the mark's name for a screen reader. */
  label: string;
  reason: string | null;
}

// The server's section order (`EVIDENCE_RUN_SECTIONS`), spelled here: this
// package may import only types from the backend (ADOPTING.md §6).
const SECTIONS: readonly EvidenceRunSection[] = ['PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY', 'APPLE_PAY'];
const FULL_RUN: readonly EvidenceRunStep[] = ['prepare', 'encrypt', ...SECTIONS, 'file'];
const DOWNLOAD_ONLY: readonly EvidenceRunStep[] = ['file'];

/** The step a phase — and, while running, the server's section — is on. */
function currentEvidenceStep(phase: EvidencePhase, section: EvidenceRunSection | null): EvidenceRunStep {
  if (phase === 'preparing') return 'prepare';
  if (phase === 'encrypting') return 'encrypt';
  if (phase === 'running') return section ?? 'PIX';
  return 'file';
}

interface EvidenceProgressProps {
  phase: EvidencePhase;
  section: EvidenceRunSection | null;
  /** False for "download the latest recorded": nothing is run. */
  full: boolean;
  /** What the wallet sheets answered for this run; null on a download-only press. */
  walletResults: BrowserWalletResult[] | null;
  /** Each step's own result once it ran (FUT-5519); a step with none reads as done. */
  results?: Partial<Record<EvidenceRunStep, EvidenceStepResult>>;
  /** The run is over: every step shows its result, and nothing is going. */
  finished?: boolean;
  /**
   * Everything runs at once (FUT-5519): the Pix and the wallets from the
   * moment the run is prepared, the cards once encrypted. Each step spins
   * until its own result arrives, in the order the run depends on.
   */
  parallel?: { cardsReady: boolean };
}

// Material Symbols' check_circle and radio_button_unchecked, inline: the
// package takes no icons dependency (see `../checkout/icons.tsx`).
const DONE_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z';
const PENDING_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8';

// Material Symbols' cancel and do_not_disturb_on: a failed step and one that did not run.
const FAILED_PATH =
  'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z';
const NOT_RUN_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m5 11H7v-2h10z';

type MarkState = 'done' | 'current' | 'pending' | 'failed' | 'notRun';

const MARK: Record<Exclude<MarkState, 'current'>, { path: string; color: string }> = {
  done: { path: DONE_PATH, color: 'success.main' },
  pending: { path: PENDING_PATH, color: 'text.secondary' },
  // Ink, never red: red does not sit beside the green checks; the shape and the reason say it.
  failed: { path: FAILED_PATH, color: 'text.primary' },
  notRun: { path: NOT_RUN_PATH, color: 'text.secondary' },
};

/**
 * Shape, not only colour, tells the states apart. The spinner and the
 * bar take the ink, never the theme's primary: on a staff screen whose primary
 * is red they would read as a failure beside the green checks.
 */
function StepMark({ state, label }: { state: MarkState; label?: string }): ReactNode {
  return (
    <Box sx={{ width: 20, height: 20, flexShrink: 0, display: 'grid', placeItems: 'center', mt: '2px' }}>
      {state === 'current' ? (
        <CircularProgress size={18} thickness={5} color="inherit" sx={{ color: 'text.primary' }} />
      ) : (
        <SvgIcon fontSize="small" sx={{ color: MARK[state].color }} titleAccess={label}>
          <path d={MARK[state].path} />
        </SvgIcon>
      )}
    </Box>
  );
}

const MARK_OF_RESULT: Record<EvidenceStepResult['kind'], MarkState> = { executed: 'done', failed: 'failed', pending: 'notRun' };

/** A step's mark: its own result once it ran, else where the run is. */
function stateOf(index: number, at: number, result: EvidenceStepResult | undefined): MarkState {
  if (index > at) return 'pending';
  if (index === at) return 'current';
  return result ? MARK_OF_RESULT[result.kind] : 'done';
}

/** The order a parallel run depends on: what needs no card first, then the cards. */
const PARALLEL_RUN: readonly EvidenceRunStep[] = ['prepare', 'PIX', 'GOOGLE_PAY', 'APPLE_PAY', 'encrypt', 'CARD', 'DEBIT', 'file'];

/** A parallel run's step: its own result once known, spinning while it runs, else waiting. */
function parallelState(
  step: EvidenceRunStep,
  phase: EvidencePhase,
  result: EvidenceStepResult | undefined,
  cardsReady: boolean,
): MarkState {
  if (step === 'prepare') return phase === 'preparing' ? 'current' : 'done';
  if (phase === 'preparing' || step === 'file') return 'pending';
  if (result) return MARK_OF_RESULT[result.kind];
  return runningState(step, cardsReady);
}

/** A step of a parallel run with no result yet: the cards wait for their encryption. */
function runningState(step: EvidenceRunStep, cardsReady: boolean): MarkState {
  if (step === 'encrypt') return cardsReady ? 'done' : 'current';
  if (step === 'CARD' || step === 'DEBIT') return cardsReady ? 'current' : 'pending';
  return 'current';
}

/** A step's result, shown only once it has one: never on a step still going or waiting. */
const shownResult = (state: MarkState, result: EvidenceStepResult | undefined): EvidenceStepResult | undefined =>
  state === 'current' || state === 'pending' ? undefined : result;

/** Each step's mark, and how far the bar is. */
function marksOf(props: EvidenceProgressProps): { steps: readonly EvidenceRunStep[]; states: MarkState[]; done: number } {
  const { phase, section, full, results, finished = false, parallel } = props;
  if (parallel && full && !finished) {
    const states = PARALLEL_RUN.map((step) => parallelState(step, phase, results?.[step], parallel.cardsReady));
    return { steps: PARALLEL_RUN, states, done: states.filter((state) => state !== 'current' && state !== 'pending').length };
  }
  const steps = full ? (parallel ? PARALLEL_RUN : FULL_RUN) : DOWNLOAD_ONLY;
  const at = finished ? steps.length : steps.indexOf(currentEvidenceStep(phase, section));
  const states = steps.map((step, index) => stateOf(index, at, index < at ? results?.[step] : undefined));
  return { steps, states, done: at };
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

export function EvidenceProgress(props: EvidenceProgressProps): ReactNode {
  const { phase, full, walletResults, results, finished = false } = props;
  const copy = usePlatformCopy().evidence;
  const { steps, states, done } = marksOf(props);
  return (
    <Stack spacing={1} role="status" aria-busy={!finished} data-testid="evidence-phase">
      {finished ? null : <Typography variant="body2">{copy.phases[phase]}</Typography>}
      <LinearProgress
        variant="determinate"
        value={(done / steps.length) * 100}
        aria-label={copy.steps.label}
        color="inherit"
        sx={{ color: 'text.primary' }}
      />
      {full ? (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }} data-testid="evidence-steps">
          {steps.map((step, index) => {
            const state = states[index]!;
            const result = shownResult(state, results?.[step]);
            return (
              <Stack
                key={step}
                component="li"
                direction="row"
                spacing={1}
                sx={{ alignItems: 'flex-start', minHeight: 24 }}
                data-testid={`evidence-step-${step}`}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <StepMark state={state} label={result?.label} />
                <Typography
                  variant="body2"
                  fontWeight={state === 'current' ? 600 : 400}
                  color={state === 'pending' ? 'text.secondary' : 'text.primary'}
                  sx={{ minWidth: 0 }}
                >
                  {copy.steps.names[step]}
                  {result && result.kind !== 'executed' ? (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {' · '}
                      {result.label}
                      {result.reason ? ` — ${result.reason}` : ''}
                    </Typography>
                  ) : null}
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
