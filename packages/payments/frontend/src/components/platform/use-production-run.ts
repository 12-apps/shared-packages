import { useEffect, useRef, useState } from 'react';

import type { BrowserCardResult, EvidenceRunSection, EvidenceSummary } from '@12-apps/payments-backend';

import type { EvidencePhase } from './HomologacaoEvidenceProgress';
import type { EvidenceWallets } from './HomologacaoEvidenceWallets';
import type { HomologacaoProductionEvidenceCardProps } from './HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from './ProductionPixPanel';
import {
  authenticateRealDebit,
  buyerOf,
  cardOf,
  EMPTY_CARD,
  encryptRealCard,
  isBlank,
  rememberBuyer,
  rememberedBuyer,
  type BuyerForm,
  type CardForm,
} from './production-evidence-data';

/**
 * The PRODUCTION evidence card's state (FUT-4198): the form, and one run at a
 * time — its phase, the section the server is on, where it failed, the counts
 * it answered, and the Pix it raised, checked until the server settles it.
 */

type Phase = 'idle' | EvidencePhase;

const PIX_POLL_MS = 5000;

const isPixOpen = (pix: ProductionPixView | null | undefined): boolean =>
  pix?.state === 'AWAITING_PAYMENT' || pix?.state === 'REFUND_PENDING';

/** The cardholder and the two cards, and whether they are enough to charge. */
export function useProductionForm() {
  const [buyer, setBuyer] = useState<BuyerForm>(rememberedBuyer);
  const [credit, setCredit] = useState<CardForm>(EMPTY_CARD);
  const [debit, setDebit] = useState<CardForm>(EMPTY_CARD);
  const ready = buyerOf(buyer) !== null && cardOf(credit) !== null && (isBlank(debit) || cardOf(debit) !== null);
  // Cleared once a run is through: the real card numbers are not kept past it (a failed run keeps them for the retry).
  const clearCards = (): void => {
    setCredit(EMPTY_CARD);
    setDebit(EMPTY_CARD);
  };
  return {
    ready,
    buyer,
    credit,
    debit,
    clearCards,
    fields: { buyer, onBuyer: setBuyer, credit, onCredit: setCredit, debit, onDebit: setDebit },
  };
}

type ProductionForm = ReturnType<typeof useProductionForm>;

/** The cards the browser sends: the credit one always, the debit one unless it was left blank. */
async function browserCards(
  prepared: Awaited<ReturnType<HomologacaoProductionEvidenceCardProps['onPrepare']>>,
  holder: string,
  credit: CardForm,
  debit: CardForm,
): Promise<BrowserCardResult[]> {
  const cards: BrowserCardResult[] = [];
  const creditCard = cardOf(credit);
  if (creditCard) cards.push(await encryptRealCard('approved', creditCard, holder, prepared.publicKey));
  const debitCard = isBlank(debit) ? null : cardOf(debit);
  if (debitCard) {
    cards.push(
      await authenticateRealDebit(debitCard, holder, prepared.publicKey, prepared.threeDSSession ?? null, prepared.debitTest),
    );
  }
  return cards;
}

/** Keep checking an open Pix, one call at a time, until the server says it is settled. */
function usePixPolling(
  pix: ProductionPixView | null,
  setPix: (next: ProductionPixView) => void,
  onConfirmPix: HomologacaoProductionEvidenceCardProps['onConfirmPix'],
  everyMs: number,
): void {
  const busy = useRef(false);
  // The host's callback through a ref: an inline one, new on every render,
  // must not restart the timer before it ever fires.
  const confirm = useRef(onConfirmPix);
  confirm.current = onConfirmPix;
  const runId = pix && isPixOpen(pix) ? pix.runId : null;
  useEffect(() => {
    if (!runId) return undefined;
    const timer = setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      confirm
        .current(runId, 'CHECK')
        .then(setPix)
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    }, everyMs);
    return () => clearInterval(timer);
  }, [runId, setPix, everyMs]);
}

/** The run's Pix: picked up from the server on load, checked while open, skippable. */
function useProductionPix(props: HomologacaoProductionEvidenceCardProps) {
  const [pix, setPix] = useState<ProductionPixView | null>(null);
  const [skipping, setSkipping] = useState(false);
  // A reloaded screen picks up the open Pix the server still holds — and so
  // does one whose run answer was lost after the server raised its Pix: the
  // server's open Pix wins over anything but the same run, still open here.
  const serverPix = props.seller?.pix ?? null;
  useEffect(() => {
    if (!serverPix || !isPixOpen(serverPix)) return;
    setPix((current) => (current && isPixOpen(current) && current.runId === serverPix.runId ? current : serverPix));
  }, [serverPix]);
  usePixPolling(pix, setPix, props.onConfirmPix, props.pixPollMs ?? PIX_POLL_MS);
  const skip = (): void => {
    if (!pix) return;
    setSkipping(true);
    props
      .onConfirmPix(pix.runId, 'SKIP')
      .then(setPix)
      .catch(() => undefined)
      .finally(() => setSkipping(false));
  };
  return { pix, setPix, skip, skipping, pixOpen: isPixOpen(pix) };
}

/** Step 4: build and save the file, answering its counts — or where it failed. */
function useDownload(
  onDownload: HomologacaoProductionEvidenceCardProps['onDownload'],
  setPhase: (phase: Phase) => void,
  setFailed: (phase: EvidencePhase | null) => void,
  setSummary: (summary: EvidenceSummary) => void,
): () => Promise<void> {
  return async () => {
    setFailed(null);
    setPhase('downloading');
    try {
      setSummary(await onDownload());
    } catch {
      setFailed('downloading');
    } finally {
      setPhase('idle');
    }
  };
}

export function useProductionRun(
  props: HomologacaoProductionEvidenceCardProps,
  form: ProductionForm,
  wallets: Pick<EvidenceWallets, 'collect' | 'reset'>,
) {
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [section, setSection] = useState<EvidenceRunSection | null>(null);
  const [failed, setFailed] = useState<EvidencePhase | null>(null);
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const [ran, setRan] = useState(false);
  const { pix, setPix, skip, skipping, pixOpen } = useProductionPix(props);
  // One run at a time, whatever a double click on the confirmation does.
  const inFlight = useRef(false);

  const run = async (): Promise<void> => {
    const buyer = buyerOf(form.buyer);
    if (!buyer || inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    setFailed(null);
    setSummary(null);
    setSection(null);
    rememberBuyer(form.buyer);
    let current: EvidencePhase = 'preparing';
    let runId: string | null = null;
    const enter = (next: EvidencePhase): void => {
      current = next;
      setPhase(next);
    };
    try {
      enter('preparing');
      const walletResults = wallets.collect();
      const prepared = await props.onPrepare(buyer);
      runId = prepared.runId;
      // The wallets' tokens are spent only once a run exists to spend them on.
      wallets.reset();
      enter('encrypting');
      const cards = await browserCards(prepared, buyer.name, form.credit, form.debit);
      enter('running');
      setPix(await props.onRun(prepared.runId, cards, walletResults, setSection, buyer));
      setRan(true);
      form.clearCards();
    } catch {
      setFailed(current);
      // The run may have raised its Pix before its answer was lost: ask.
      if (runId) await props.onConfirmPix(runId, 'CHECK').then(setPix, () => undefined);
    } finally {
      setPhase('idle');
      inFlight.current = false;
    }
  };

  const download = useDownload(props.onDownload, setPhase, setFailed, setSummary);

  return {
    confirming,
    setConfirming,
    phase,
    section,
    failed,
    summary,
    pix,
    skipping,
    busy: phase !== 'idle',
    pixOpen,
    charged: ran && !pixOpen,
    run,
    download,
    skip,
  };
}
