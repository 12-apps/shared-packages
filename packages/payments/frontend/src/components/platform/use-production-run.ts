import { useEffect, useRef, useState } from 'react';

import type { BrowserCardResult, BrowserWalletResult, EvidenceBuyer, EvidenceSummary } from '@12-apps/payments-backend';

import type { EvidencePhase } from './HomologacaoEvidenceProgress';
import type { EvidenceWallets } from './HomologacaoEvidenceWallets';
import type { EvidenceAppleSheet } from './evidence-apple-sheet';
import type { HomologacaoProductionEvidenceCardProps } from './HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from './ProductionPixPanel';
import type { ProductionScenarioOutcome } from './ProductionScenarioList';
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
import { useRunProgress } from './production-step-results';

/**
 * The PRODUCTION evidence card's state (FUT-4198): the form, and one run at a
 * time — its phase, the section the server is on, where it failed, the counts
 * it answered, and the Pix it raised, checked until the server settles it.
 */

type Phase = 'idle' | EvidencePhase;

const PIX_POLL_MS = 5000;
/** How long one Pix is checked on its own: past the QR's own expiry, so a late payment is still refunded. */
const PIX_POLL_WINDOW_MS = 15 * 60_000;
/**
 * How long a refund being retried is read: the server's last scheduled attempt
 * is 15 minutes after the first, so this is that plus a margin. Past it the
 * sweep is not running (no Redis, or the job was not registered) and asking
 * every few seconds would go on for as long as the tab stays open.
 */
const REFUND_POLL_WINDOW_MS = 20 * 60_000;

const isPixOpen = (pix: ProductionPixView | null | undefined): boolean =>
  pix?.state === 'AWAITING_PAYMENT' || pix?.state === 'REFUND_PENDING' || (pix?.cards?.length ?? 0) > 0;

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

/**
 * A paid Pix whose refund PagBank has not taken yet: the server retries it in
 * the background, so the card keeps reading where it stands (each read is a
 * database read, not a PagBank call) until it is refunded or out of attempts.
 */
const isRefundRetrying = (pix: ProductionPixView | null): boolean =>
  pix?.state === 'REFUND_PENDING' && pix.refund?.exhausted !== true;

/** Open, and still moving by itself: not a refund whose attempts ran out. */
const isSettling = (pix: ProductionPixView | null): boolean =>
  pix?.state === 'AWAITING_PAYMENT' ||
  (pix?.state === 'REFUND_PENDING' && pix.refund?.exhausted !== true) ||
  // A card's refund still retrying in the background (FUT-4740): the rows keep counting down.
  (pix?.cards?.some((card) => !card.exhausted) ?? false);

/**
 * Keep checking an open Pix, one call at a time, until the server says it is
 * settled — for at most `windowMs` per Pix while it waits for a person. Each
 * check asks PagBank whether a person paid it, which no webhook of ours settles
 * yet: a third-party wait, the one kind of screen poll the origin host admits,
 * and only when bounded. Past the window the screen stops asking on its own and
 * offers "Verificar o Pix" instead. A refund being retried is read for a
 * window of its own, longer than the schedule (FUT-4360). Answers whether the
 * window ran out.
 */
function usePixPolling(
  pix: ProductionPixView | null,
  setPix: (next: ProductionPixView) => void,
  onConfirmPix: HomologacaoProductionEvidenceCardProps['onConfirmPix'],
  everyMs: number,
  windowMs: number,
  refundWindowMs: number,
): boolean {
  const busy = useRef(false);
  const [expiredFor, setExpiredFor] = useState<string | null>(null);
  // The host's callback through a ref: an inline one, new on every render,
  // must not restart the timer before it ever fires.
  const confirm = useRef(onConfirmPix);
  confirm.current = onConfirmPix;
  const runId = pix && isSettling(pix) ? pix.runId : null;
  const retrying = isRefundRetrying(pix);
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
    const window = setTimeout(() => {
      clearInterval(timer);
      setExpiredFor(runId);
    }, retrying ? refundWindowMs : windowMs);
    return () => {
      clearInterval(timer);
      clearTimeout(window);
    };
  }, [runId, retrying, setPix, everyMs, windowMs, refundWindowMs]);
  return runId !== null && expiredFor === runId;
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
  const pollStopped = usePixPolling(
    pix,
    setPix,
    props.onConfirmPix,
    props.pixPollMs ?? PIX_POLL_MS,
    props.pixPollWindowMs ?? PIX_POLL_WINDOW_MS,
    props.pixRefundWindowMs ?? REFUND_POLL_WINDOW_MS,
  );
  const act = (action: 'CHECK' | 'SKIP' | 'RETRY_REFUND'): void => {
    if (!pix) return;
    setSkipping(true);
    props
      .onConfirmPix(pix.runId, action)
      .then(setPix)
      .catch(() => undefined)
      .finally(() => setSkipping(false));
  };
  return {
    pix,
    setPix,
    skip: () => act('SKIP'),
    retryRefund: () => act('RETRY_REFUND'),
    check: pollStopped ? () => act('CHECK') : null,
    skipping,
    pixOpen: isPixOpen(pix),
  };
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

type Answered = { scenarios: readonly ProductionScenarioOutcome[] | null } | null;

/**
 * The latest run's outcomes are always on screen, a reload included (FUT-5519),
 * with the date that run started: the answer of the run this tab made, else the
 * server's latest run. The host reads the server again once a run ends, so a
 * run that failed after it was saved shows its own rows once the server names
 * it; until then the earlier run's rows are not shown as its own. A run that
 * failed before it was saved leaves the earlier run on screen, still the latest.
 */
function useShownOutcomes(
  seller: HomologacaoProductionEvidenceCardProps['seller'],
  answered: Answered,
  ownRunId: string | null,
): { scenarios: readonly ProductionScenarioOutcome[] | null; ranAt: string | null } {
  const serverIsCurrent = ownRunId === null || seller?.lastRunId === ownRunId;
  const ranAt = serverIsCurrent ? (seller?.lastRunAt ?? null) : null;
  if (answered) return { scenarios: answered.scenarios, ranAt };
  return { scenarios: serverIsCurrent ? (seller?.scenarios ?? null) : null, ranAt };
}

/** The run this tab made — its id once saved, and its answer — and the outcomes the card shows. */
function useLatestRun(seller: HomologacaoProductionEvidenceCardProps['seller']) {
  // Once a run answered: its outcomes (a bare Pix answer leaves them unknown).
  const [answered, setAnswered] = useState<Answered>(null);
  // The run this tab saved last: from then on only its own outcomes are shown.
  const [ownRunId, setOwnRunId] = useState<string | null>(null);
  const saved = (runId: string): void => {
    setOwnRunId(runId);
    // The previous run's answer is not this one's.
    setAnswered(null);
  };
  return { answered, setAnswered, saved, ...useShownOutcomes(seller, answered, ownRunId) };
}

/**
 * Apple Pay, charged while its sheet is open (FUT-5519): wait for the person
 * to authorize, raise its order on the prepared run, and close the sheet with
 * PagBank's answer. Answers what phase 2 still owes for Apple Pay: nothing
 * once the sheet charged it, else why it was not charged.
 */
async function chargeAppleInSheet(
  sheet: EvidenceAppleSheet | null,
  charge: HomologacaoProductionEvidenceCardProps['onChargeApplePay'],
  runId: string,
  buyer: EvidenceBuyer,
): Promise<BrowserWalletResult[]> {
  if (!sheet) return [];
  const result = await sheet.result;
  if (!result.token || !charge) {
    sheet.complete(false);
    return [result.token ? { ...result, token: null, failure: 'TOKEN_ERROR' } : result];
  }
  const paid = await charge(runId, result, buyer).then(
    (answer) => answer.paid,
    () => null,
  );
  sheet.complete(paid === true);
  // Not raised at all (the call failed): phase 2 records why, never a pressless pending.
  return paid === null ? [{ ...result, token: null, failure: 'TOKEN_ERROR' }] : [];
}

/** A sheet the run will not charge is closed as unpaid, once the person answers it. */
function closeUnpaid(sheet: EvidenceAppleSheet | null): void {
  if (sheet) void sheet.result.then(() => sheet.complete(false));
}

export function useProductionRun(
  props: HomologacaoProductionEvidenceCardProps,
  form: ProductionForm,
  wallets: Pick<EvidenceWallets, 'collect' | 'reset'>,
) {
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failed, setFailed] = useState<EvidencePhase | null>(null);
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const { answered, setAnswered, saved, scenarios, ranAt } = useLatestRun(props.seller);
  const progress = useRunProgress();
  const { pix, setPix, skip, retryRefund, check, skipping, pixOpen } = useProductionPix(props);
  const run = async (appleSheet: EvidenceAppleSheet | null = null): Promise<void> => {
    const buyer = buyerOf(form.buyer);
    if (!buyer || !progress.begin()) return closeUnpaid(appleSheet);
    setConfirming(false);
    setFailed(null);
    setSummary(null);
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
      saved(prepared.runId);
      walletResults.push(...(await chargeAppleInSheet(appleSheet, props.onChargeApplePay, prepared.runId, buyer)));
      // The wallets' tokens are spent only once a run exists to spend them on.
      wallets.reset();
      enter('encrypting');
      const cards = await browserCards(prepared, buyer.name, form.credit, form.debit);
      progress.prepared(cards);
      enter('running');
      const answer = await props.onRun(prepared.runId, cards, walletResults, progress.onSection, buyer);
      setAnswered({ scenarios: 'pix' in answer ? answer.scenarios : null });
      setPix('pix' in answer ? answer.pix : answer);
      form.clearCards();
    } catch {
      // A sheet still open when the run broke is closed as not charged.
      closeUnpaid(appleSheet);
      setFailed(current);
      // The run may have raised its Pix before its answer was lost: ask.
      if (runId) await props.onConfirmPix(runId, 'CHECK').then(setPix, () => undefined);
    } finally {
      setPhase('idle');
      progress.end(runId !== null);
      props.onRunEnded?.();
    }
  };

  const download = useDownload(props.onDownload, setPhase, setFailed, setSummary);

  return {
    confirming,
    setConfirming,
    phase,
    progress,
    failed,
    summary,
    pix,
    skipping,
    retrying: skipping,
    busy: phase !== 'idle',
    pixOpen,
    scenarios,
    ranAt,
    ran: answered !== null,
    charged: answered !== null && !pixOpen,
    run,
    download,
    skip,
    retryRefund,
    check,
  };
}
