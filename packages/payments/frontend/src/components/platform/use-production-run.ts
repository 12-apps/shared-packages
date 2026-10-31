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
  // The real card numbers are not kept a moment longer than the run needs them.
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
  useEffect(() => {
    if (!pix || !isPixOpen(pix)) return undefined;
    const timer = setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      onConfirmPix(pix.runId, 'CHECK')
        .then(setPix)
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    }, everyMs);
    return () => clearInterval(timer);
  }, [pix, setPix, onConfirmPix, everyMs]);
}

/** The run's Pix: picked up from the server on load, checked while open, skippable. */
function useProductionPix(props: HomologacaoProductionEvidenceCardProps) {
  const [pix, setPix] = useState<ProductionPixView | null>(null);
  const [skipping, setSkipping] = useState(false);
  // A reloaded screen picks up the open Pix the server still holds.
  const serverPix = props.seller?.pix ?? null;
  useEffect(() => {
    if (isPixOpen(serverPix)) setPix((current) => current ?? serverPix);
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

  const run = async (): Promise<void> => {
    const buyer = buyerOf(form.buyer);
    if (!buyer) return;
    setConfirming(false);
    setFailed(null);
    setSummary(null);
    setSection(null);
    rememberBuyer(form.buyer);
    let current: EvidencePhase = 'preparing';
    const enter = (next: EvidencePhase): void => {
      current = next;
      setPhase(next);
    };
    try {
      enter('preparing');
      const walletResults = wallets.collect();
      wallets.reset();
      const prepared = await props.onPrepare(buyer);
      enter('encrypting');
      const cards = await browserCards(prepared, buyer.name, form.credit, form.debit);
      enter('running');
      setPix(await props.onRun(prepared.runId, cards, walletResults, setSection, buyer));
      setRan(true);
      form.clearCards();
    } catch {
      setFailed(current);
    } finally {
      setPhase('idle');
    }
  };

  const download = async (): Promise<void> => {
    setFailed(null);
    setPhase('downloading');
    try {
      setSummary(await props.onDownload());
    } catch {
      setFailed('downloading');
    } finally {
      setPhase('idle');
    }
  };

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
