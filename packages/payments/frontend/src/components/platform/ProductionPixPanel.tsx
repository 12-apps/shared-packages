'use client';

import { Alert, Button, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { PixQr, useClipboardCopy } from '../checkout/pix-parts';
import { TAP_SX } from './ConnectEnvironmentCard';
import type { HomologacaoProductionEvidenceCopy } from './copy';

/**
 * The Pix a person pays during the PRODUCTION evidence run (FUT-4198): the
 * QR, how long it stays payable, copy-and-paste, and a way out. What the Pix
 * IS (waiting, refunded, skipped) is the server's answer; this panel only
 * draws it.
 */

/** Where the server says the run's Pix stands — `EvidencePixView` from the backend. */
export interface ProductionPixView {
  runId: string;
  state: 'NONE' | 'AWAITING_PAYMENT' | 'REFUND_PENDING' | 'REFUNDED' | 'SKIPPED';
  qrText: string | null;
  expiresAt: string | null;
}

/** `mm:ss` until `expiresAt`, ticking once a second; null when there is no expiry. */
function useTimeLeft(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

/** A Pix with no QR to pay: paid and refunded, refunding, skipped — or nothing to say. */
function PixSettled({ state, copy }: { state: ProductionPixView['state']; copy: HomologacaoProductionEvidenceCopy['pix'] }): ReactNode {
  if (state === 'REFUNDED') return <Alert severity="success" data-testid="production-pix-done">{copy.paid}</Alert>;
  if (state === 'SKIPPED') return <Alert severity="info" data-testid="production-pix-done">{copy.skipped}</Alert>;
  if (state === 'REFUND_PENDING') return <Alert severity="info" data-testid="production-pix-refunding">{copy.refunding}</Alert>;
  return null;
}

export function ProductionPixPanel({
  pix,
  copy,
  onSkip,
  skipping,
}: {
  pix: ProductionPixView;
  copy: HomologacaoProductionEvidenceCopy['pix'];
  onSkip: () => void;
  skipping: boolean;
}): ReactNode {
  const timeLeft = useTimeLeft(pix.state === 'AWAITING_PAYMENT' ? pix.expiresAt : null);
  const clipboard = useClipboardCopy(pix.qrText ?? '');
  const panel = useRef<HTMLDivElement | null>(null);
  const awaiting = pix.state === 'AWAITING_PAYMENT' && Boolean(pix.qrText);
  // On a phone the QR lands under the whole form: bring it to the person, once per Pix.
  useEffect(() => {
    if (awaiting) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [awaiting, pix.runId]);
  if (!awaiting || !pix.qrText) return <PixSettled state={pix.state} copy={copy} />;
  return (
    <Stack
      ref={panel}
      spacing={1.5}
      data-testid="production-pix"
      sx={{ alignItems: 'center', border: 1, borderColor: 'divider', borderRadius: 2.5, p: 2.5 }}
    >
      <Typography variant="body1" fontWeight={600}>
        {copy.title}
      </Typography>
      <PixQr payload={pix.qrText} size={200} alt={copy.qrAlt} testId="production-pix-qr" />
      <Typography variant="body2" color="text.secondary" textAlign="center">
        {copy.hint}
        {timeLeft ? ` · ${copy.expires(timeLeft)}` : ''}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button variant="outlined" onClick={() => void clipboard.copy()} sx={TAP_SX} data-testid="production-pix-copy">
          {clipboard.justCopied ? copy.copied : copy.copy}
        </Button>
        <Button variant="text" onClick={onSkip} disabled={skipping} sx={TAP_SX} data-testid="production-pix-skip">
          {copy.skip}
        </Button>
      </Stack>
    </Stack>
  );
}
