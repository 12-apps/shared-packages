'use client';

import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type {
  BrowserCardResult,
  EvidenceSummary,
  PaymentEnvironment,
} from '@12-apps/payments-backend';

import { maskTestCard, PAGBANK_TEST_CARDS } from '../../card/pagbank-test-cards';
import { encryptPagBankCard } from '../../card/tokenize';
import { CARD_SX, TAP_SX } from './ConnectEnvironmentCard';
import type { PlatformHomologacaoCopy } from './copy';
import { PlatformCopyProvider, usePlatformCopy } from './copy-context';

/**
 * The homologação EVIDENCE card (FUT-3696): connect a sandbox test seller,
 * then run the real scenarios and download the TXT PagBank's form takes.
 *
 * The one thing this card does itself is the part that has to happen in a
 * browser: encrypting PagBank's official TEST cards with the seller's public
 * key, through the same SDK call the checkout makes. Everything else is the
 * host's — each callback is a call to its own mounted routes — and what the
 * file says is decided by the server, from what was recorded. This card shows
 * the counts it answered and never infers a result of its own.
 */

/** The test seller's connection, as the host reads it back. */
export interface HomologacaoSellerView {
  connected: boolean;
  environment: PaymentEnvironment | null;
  /** UNVERIFIED | VERIFIED | FAILED | RECONNECT_REQUIRED. */
  status: string | null;
  connectedAt: string | null;
  accountId: string | null;
  /** Why the latest authorization did not complete, as the evidence recorded it. */
  lastConnectProblem?: string | null;
}

export interface HomologacaoEvidenceCardProps {
  copy: PlatformHomologacaoCopy;
  /** Null while the host is still reading it. */
  seller: HomologacaoSellerView | null;
  /** How the last return from PagBank ended, when the page was opened by one. */
  connectOutcome?: 'connected' | 'failed' | null;
  /** Start the authorization: the host mints the state and navigates away. */
  onConnect: () => Promise<void>;
  /** Phase 1 — the seller's public key, null when it could not be minted. */
  onPrepare: () => Promise<{ runId: string; publicKey: string | null }>;
  /** Phase 2 — raise the orders with the encrypted cards. */
  onRun: (runId: string, cards: BrowserCardResult[]) => Promise<void>;
  /** Build and deliver the file; resolves to the counts it holds. */
  onDownload: () => Promise<EvidenceSummary>;
}

type Phase = 'idle' | 'preparing' | 'encrypting' | 'running' | 'downloading';
type ActivePhase = Exclude<Phase, 'idle'>;

/** Each official test card, encrypted — or the code saying why it is not. */
async function encryptTestCards(publicKey: string | null): Promise<BrowserCardResult[]> {
  const results: BrowserCardResult[] = [];
  for (const card of PAGBANK_TEST_CARDS) {
    const base = { scenario: card.scenario, brand: card.brand, masked: maskTestCard(card.number) };
    if (!publicKey) {
      results.push({ ...base, encrypted: null, failure: 'NO_PUBLIC_KEY' });
      continue;
    }
    const encrypted = await encryptPagBankCard({
      publicKey,
      holder: card.holder,
      number: card.number,
      expMonth: card.expMonth,
      expYear: card.expYear,
      securityCode: card.securityCode,
    });
    results.push(
      'encrypted' in encrypted
        ? { ...base, encrypted: encrypted.encrypted }
        : { ...base, encrypted: null, failure: encrypted.failure },
    );
  }
  return results;
}

export function HomologacaoEvidenceCard(props: HomologacaoEvidenceCardProps): ReactNode {
  return (
    <PlatformCopyProvider copy={props.copy}>
      <EvidenceBody {...props} />
    </PlatformCopyProvider>
  );
}

/** The seller's one-line state — null while the host is still reading it. */
function sellerLine(copy: PlatformHomologacaoCopy['evidence'], seller: HomologacaoSellerView | null): string | null {
  if (!seller) return null;
  if (seller.status === 'RECONNECT_REQUIRED') return copy.sellerReconnect;
  return seller.connected ? copy.sellerConnected(seller.connectedAt, seller.accountId) : copy.sellerNotConnected;
}

function SellerBlock({
  seller,
  onConnect,
}: Pick<HomologacaoEvidenceCardProps, 'seller' | 'onConnect'>): ReactNode {
  const copy = usePlatformCopy().evidence;
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const line = sellerLine(copy, seller);
  const offerReconnect = Boolean(seller?.connected) && seller?.status !== 'RECONNECT_REQUIRED';
  const connect = (): void => {
    setBusy(true);
    setFailed(false);
    onConnect()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <Stack spacing={1} data-testid="evidence-seller">
      <Typography variant="body2" fontWeight={600}>
        {copy.sellerHeading}
      </Typography>
      {line ? (
        <Typography variant="body2" data-testid="evidence-seller-state">
          {line}
        </Typography>
      ) : null}
      <Typography variant="caption" component="p" color="text.secondary">
        {copy.connectHint}
      </Typography>
      <Box>
        <Button
          // The next step until a seller is connected; secondary once one is.
          variant={offerReconnect ? 'outlined' : 'contained'}
          size="small"
          disabled={!seller || busy}
          onClick={connect}
          data-testid="evidence-connect"
          sx={TAP_SX}
        >
          {offerReconnect ? copy.reconnect : copy.connect}
        </Button>
      </Box>
      {failed ? (
        <Alert severity="error" data-testid="evidence-connect-failed">
          {copy.connectFailed}
        </Alert>
      ) : null}
    </Stack>
  );
}

/** One run at a time: which phase it is in, what it answered, where it failed. */
function useEvidenceRun({ onPrepare, onRun, onDownload }: Pick<HomologacaoEvidenceCardProps, 'onPrepare' | 'onRun' | 'onDownload'>) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const [failed, setFailed] = useState<ActivePhase | null>(null);
  const run = async (full: boolean): Promise<void> => {
    setFailed(null);
    setSummary(null);
    // The phase that throws is the one the operator is told about.
    let current: ActivePhase = full ? 'preparing' : 'downloading';
    const enter = (next: ActivePhase): void => {
      current = next;
      setPhase(next);
    };
    try {
      if (full) {
        enter('preparing');
        const prepared = await onPrepare();
        enter('encrypting');
        const cards = await encryptTestCards(prepared.publicKey);
        enter('running');
        await onRun(prepared.runId, cards);
      }
      enter('downloading');
      setSummary(await onDownload());
    } catch {
      setFailed(current);
    } finally {
      setPhase('idle');
    }
  };
  return { phase, busy: phase !== 'idle', summary, failed, run };
}

/** How the last return from PagBank ended — with the recorded reason when it failed. */
function ConnectOutcome({ seller, connectOutcome }: Pick<HomologacaoEvidenceCardProps, 'seller' | 'connectOutcome'>): ReactNode {
  const copy = usePlatformCopy().evidence;
  // The URL only says PagBank came back; the seller's own row says whether it
  // connected. A "connected" the row does not confirm is not announced.
  const outcome = connectOutcome === 'connected' && !seller?.connected ? null : connectOutcome;
  if (!outcome) return null;
  return (
    <Alert severity={outcome === 'connected' ? 'success' : 'warning'} data-testid="evidence-connect-outcome">
      {outcome === 'connected' ? copy.returnedConnected : (seller?.lastConnectProblem ?? copy.returnedFailed)}
    </Alert>
  );
}

function EvidenceBody(props: HomologacaoEvidenceCardProps): ReactNode {
  const { seller, onConnect } = props;
  const copy = usePlatformCopy().evidence;
  const { phase, busy, summary, failed, run } = useEvidenceRun(props);
  return (
    <Stack spacing={1.5} data-testid="homologacao-evidence-card" sx={CARD_SX}>
      <Typography variant="body2" fontWeight={600}>
        {copy.heading}
      </Typography>
      <Typography variant="caption" component="p">
        {copy.lede}
      </Typography>
      <ConnectOutcome seller={seller} connectOutcome={props.connectOutcome} />
      <SellerBlock seller={seller} onConnect={onConnect} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Button
          variant={seller?.connected ? 'contained' : 'outlined'}
          size="small"
          disabled={busy}
          onClick={() => void run(true)}
          data-testid="evidence-generate"
          sx={TAP_SX}
        >
          {copy.generate}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={busy}
          onClick={() => void run(false)}
          data-testid="evidence-download-latest"
          sx={TAP_SX}
        >
          {copy.downloadLatest}
        </Button>
      </Stack>
      {busy ? (
        <Stack spacing={0.5} role="status" aria-busy="true" data-testid="evidence-phase">
          <Typography variant="body2">{copy.phases[phase as ActivePhase]}</Typography>
          <LinearProgress />
        </Stack>
      ) : null}
      <EvidenceResult summary={summary} failed={failed} />
    </Stack>
  );
}

/** The server's counts — never inferred here — or the failure line. */
function EvidenceResult({
  summary,
  failed,
}: {
  summary: EvidenceSummary | null;
  failed: ActivePhase | null;
}): ReactNode {
  const copy = usePlatformCopy().evidence;
  if (failed) {
    return (
      <Alert severity="error" data-testid="evidence-generate-failed">
        {copy.generateFailed(failed)}
      </Alert>
    );
  }
  if (!summary) return null;
  return (
    <Stack spacing={0.5} role="status" data-testid="evidence-summary">
      <Typography variant="body2" fontWeight={600} data-testid="evidence-summary-counts">
        {copy.summary(summary)}
      </Typography>
      {summary.failed + summary.pending > 0 ? (
        <Typography variant="caption" component="p" data-testid="evidence-incomplete">
          {copy.incomplete}
        </Typography>
      ) : null}
    </Stack>
  );
}
