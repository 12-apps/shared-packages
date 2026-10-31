'use client';

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';

import type {
  BrowserCardResult,
  BrowserWalletResult,
  DebitTestData,
  EvidenceBuyer,
  EvidenceRunSection,
  EvidenceSummary,
  ThreeDSecureSession,
} from '@12-apps/payments-backend';

import type { GooglePayApi } from '../checkout/google-pay-button';
import { CARD_SX, TAP_SX } from './ConnectEnvironmentCard';
import type { HomologacaoProductionEvidenceCopy, PlatformHomologacaoCopy } from './copy';
import { PlatformCopyProvider } from './copy-context';
import { ConnectOutcome, EvidenceResult, SellerBlock, type HomologacaoSellerView } from './HomologacaoEvidenceCard';
import { EvidenceProgress } from './HomologacaoEvidenceProgress';
import { EvidenceWalletBlock, useEvidenceWallets } from './HomologacaoEvidenceWallets';
import { ProductionEvidenceForm } from './ProductionEvidenceForm';
import { ProductionPixPanel, type ProductionPixView } from './ProductionPixPanel';
import { useProductionForm, useProductionRun } from './use-production-run';

/**
 * The PRODUCTION homologação evidence card (FUT-4198, prototype option A+C):
 * a second card under the sandbox one. Four steps — connect the platform's
 * PagBank account as the production seller, type the cardholder and the real
 * cards, charge R$ 1,00 per scenario (after typing "confirmar") and let the
 * server refund each, then download the production file. The Pix waits for a
 * person: its QR stays beside the form, checked every few seconds, until the
 * server says it is refunded or skipped.
 *
 * As in the sandbox card, the browser only encrypts and authenticates the
 * cards and opens the wallets' sheets; every other step is a call to the
 * host's routes, and every count is the server's.
 */

export interface HomologacaoProductionSellerView extends HomologacaoSellerView {
  /** The latest run's Pix, so a reloaded screen shows an open QR again. */
  pix?: ProductionPixView | null;
}

export interface HomologacaoProductionEvidenceCardProps {
  copy: PlatformHomologacaoCopy;
  seller: HomologacaoProductionSellerView | null;
  connectOutcome?: 'connected' | 'failed' | null;
  onConnect: () => Promise<void>;
  /** Phase 1, with the cardholder: the public key, the 3DS session and the debit data to authenticate with. */
  onPrepare: (buyer: EvidenceBuyer) => Promise<{
    runId: string;
    publicKey: string | null;
    threeDSSession?: ThreeDSecureSession | null;
    debitTest?: DebitTestData;
  }>;
  /** Phase 2: raise the orders; answers the run's Pix. */
  onRun: (
    runId: string,
    cards: BrowserCardResult[],
    wallets: BrowserWalletResult[],
    onSection: (section: EvidenceRunSection) => void,
    buyer: EvidenceBuyer,
  ) => Promise<ProductionPixView>;
  /** Phase 3: check the Pix, or skip it; answers where it stands. */
  onConfirmPix: (runId: string, action: 'CHECK' | 'SKIP') => Promise<ProductionPixView>;
  onDownload: () => Promise<EvidenceSummary>;
  onValidateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  googlePayApi?: GooglePayApi | null;
  /** How often an open Pix is checked; tests pass a short one. */
  pixPollMs?: number;
}

function Stepper({ copy, done }: { copy: HomologacaoProductionEvidenceCopy['stepper']; done: readonly boolean[] }): ReactNode {
  const labels = [copy.connect, copy.data, copy.charge, copy.download];
  const found = done.findIndex((isDone) => !isDone);
  const current = found === -1 ? labels.length - 1 : found;
  return (
    <Stack spacing={0.75}>
      {/* A phone has no room for four labels side by side: one line says where the operator is. */}
      <Typography variant="caption" sx={{ display: { xs: 'block', sm: 'none' } }} data-testid="production-step-progress">
        {copy.progress(current + 1, labels.length, labels[current]!)}
      </Typography>
      <Box
        component="ol"
        aria-label={copy.label}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, m: 0, p: 0, listStyle: 'none' }}
      >
        {labels.map((label, index) => (
          <Box
            component="li"
            key={label}
            aria-current={index === current ? 'step' : undefined}
            // The ink, never the theme's primary: on a staff screen whose primary is
            // red, a red bar reads as a failure (as the run's progress bar argues).
            sx={{ borderTop: 4, borderColor: done[index] || index === current ? 'text.primary' : 'divider', pt: { xs: 0, sm: 1 } }}
          >
            <Typography
              variant="caption"
              fontWeight={index === current ? 600 : 400}
              color={done[index] || index === current ? 'text.primary' : 'text.secondary'}
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              {done[index] ? '✓ ' : ''}
              {index + 1} · {label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

function ConfirmDialog({
  open,
  copy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  copy: HomologacaoProductionEvidenceCopy['confirm'];
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2">{copy.body}</Typography>
          <TextField
            size="small"
            label={copy.typeLabel}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            inputProps={{ 'data-testid': 'production-confirm-input', autoComplete: 'off' }}
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'flex-start', px: 3, pb: 2 }}>
        <Button
          variant="contained"
          disabled={typed.trim().toLowerCase() !== copy.word}
          onClick={onConfirm}
          data-testid="production-confirm-submit"
          sx={TAP_SX}
        >
          {copy.submit}
        </Button>
        <Button variant="text" onClick={onCancel} sx={TAP_SX}>
          {copy.cancel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function HomologacaoProductionEvidenceCard(props: HomologacaoProductionEvidenceCardProps): ReactNode {
  // The shared parts (seller, wallets, progress, counts) read `evidence`: give them production's lines.
  return (
    <PlatformCopyProvider copy={{ ...props.copy, evidence: props.copy.productionEvidence }}>
      <ProductionBody {...props} />
    </PlatformCopyProvider>
  );
}

/** The two actions under the form: charge (step 3), and download (step 4, or the latest recorded). */
function ProductionActions({
  copy,
  canCharge,
  charged,
  busy,
  onCharge,
  onDownload,
}: {
  copy: HomologacaoProductionEvidenceCopy;
  canCharge: boolean;
  charged: boolean;
  busy: boolean;
  onCharge: () => void;
  onDownload: () => void;
}): ReactNode {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}>
      <Button variant={charged ? 'outlined' : 'contained'} disabled={!canCharge} onClick={onCharge} data-testid="production-charge" sx={TAP_SX}>
        {copy.charge}
      </Button>
      <Button variant={charged ? 'contained' : 'text'} disabled={busy} onClick={onDownload} data-testid="production-download" sx={TAP_SX}>
        {charged ? copy.download : copy.downloadLatest}
      </Button>
    </Stack>
  );
}

type ProductionFlow = ReturnType<typeof useProductionRun>;

/** Beside the form while it matters: the run's progress, then the Pix a person pays. */
function ProductionSidePanel({ flow, copy }: { flow: ProductionFlow; copy: HomologacaoProductionEvidenceCopy }): ReactNode {
  if (!flow.busy && !flow.pix) return null;
  return (
    <Stack spacing={2} sx={{ flex: '1 1 320px', minWidth: 0 }}>
      {flow.phase !== 'idle' ? (
        <EvidenceProgress phase={flow.phase} section={flow.section} full={flow.phase !== 'downloading'} walletResults={null} />
      ) : null}
      {flow.pix ? <ProductionPixPanel pix={flow.pix} copy={copy.pix} onSkip={flow.skip} skipping={flow.skipping} /> : null}
    </Stack>
  );
}

/** What a connected seller's wallets need; nothing before one is connected. */
function walletsConfigOf(seller: HomologacaoProductionSellerView | null) {
  return seller?.connected ? (seller.wallets ?? null) : null;
}

/** Which of the four steps are done: connected, data in, charged and settled, file downloaded. */
function stepsDone(connected: boolean, ready: boolean, flow: ProductionFlow): boolean[] {
  return [connected, ready || flow.charged, flow.charged, flow.summary !== null];
}

function ProductionBody(props: HomologacaoProductionEvidenceCardProps): ReactNode {
  const copy = props.copy.productionEvidence;
  const form = useProductionForm();
  const wallets = useEvidenceWallets({
    config: walletsConfigOf(props.seller),
    validateApplePayMerchant: props.onValidateApplePayMerchant,
    googlePayApi: props.googlePayApi,
  });
  const flow = useProductionRun(props, form, wallets);
  const connected = props.seller?.connected === true;
  const showIncomplete = connected && !form.ready && !flow.charged;
  return (
    <Stack spacing={2.5} data-testid="homologacao-production-evidence-card" sx={CARD_SX}>
      <Stack spacing={0.75}>
        <Typography variant="body1" fontWeight={600}>
          {copy.heading}
        </Typography>
        <Typography variant="body2">{copy.lede}</Typography>
      </Stack>
      <Stepper copy={copy.stepper} done={stepsDone(connected, form.ready, flow)} />
      <ConnectOutcome seller={props.seller} connectOutcome={props.connectOutcome} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3.5, alignItems: 'flex-start' }}>
        <Stack spacing={2.5} sx={{ flex: '999 1 480px', minWidth: 0 }}>
          <SellerBlock seller={props.seller} onConnect={props.onConnect} />
          <ProductionEvidenceForm copy={copy} {...form.fields} disabled={flow.busy} />
          <EvidenceWalletBlock wallets={wallets} />
          <ProductionActions
            copy={copy}
            canCharge={connected && form.ready && !flow.busy && !flow.pixOpen}
            charged={flow.charged}
            busy={flow.busy}
            onCharge={() => flow.setConfirming(true)}
            onDownload={() => void flow.download()}
          />
          {showIncomplete ? (
            <Typography variant="caption" color="text.secondary" data-testid="production-incomplete-data">
              {copy.incompleteData}
            </Typography>
          ) : null}
          <EvidenceResult summary={flow.summary} failed={flow.failed} />
        </Stack>
        <ProductionSidePanel flow={flow} copy={copy} />
      </Box>
      <ConfirmDialog open={flow.confirming} copy={copy.confirm} onCancel={() => flow.setConfirming(false)} onConfirm={() => void flow.run()} />
    </Stack>
  );
}
