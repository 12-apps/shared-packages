import { useEffect, useRef, useState } from 'react';

import type { EvidenceBuyer, EvidenceRunSection, EvidenceSummary } from '@12-apps/payments-backend';

import type { EvidencePhase } from './HomologacaoEvidenceProgress';
import type { EvidenceWallets } from './HomologacaoEvidenceWallets';
import type { EvidenceAppleSheet } from './evidence-apple-sheet';
import type { HomologacaoProductionEvidenceCardProps, ProductionRunAnswer } from './HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from './ProductionPixPanel';
import type { ProductionScenarioOutcome } from './ProductionScenarioList';
import {
  buyerOf,
  cardOf,
  EMPTY_CARD,
  isBlank,
  rememberBuyer,
  rememberedBuyer,
  type BuyerForm,
  type CardForm,
} from './production-evidence-data';
import { useRunProgress } from './production-step-results';
import { raiseRunOrders } from './production-run-orders';

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
  // A retry (FUT-5584) needs only the cards of the sections it raises: a debit-only retry needs no credit card.
  const retryInputs = { buyer: buyerOf(buyer) !== null, credit: cardOf(credit) !== null, debit: !isBlank(debit) && cardOf(debit) !== null };
  // Cleared once a run is through: the real card numbers are not kept past it (a failed run keeps them for the retry).
  const clearCards = (): void => {
    setCredit(EMPTY_CARD);
    setDebit(EMPTY_CARD);
  };
  return {
    ready,
    retryInputs,
    buyer,
    credit,
    debit,
    clearCards,
    fields: { buyer, onBuyer: setBuyer, credit, onCredit: setCredit, debit, onDebit: setDebit },
  };
}

type ProductionForm = ReturnType<typeof useProductionForm>;

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

/** Where the run reports to: the cards ready (then it is running), and each outcome as it arrives. */
function reporters(progress: ReturnType<typeof useRunProgress>, enter: (next: EvidencePhase) => void) {
  return {
    onCards: (cards: Parameters<typeof progress.prepared>[0]) => {
      progress.prepared(cards);
      enter('running');
    },
    onTold: progress.told,
    onSection: progress.onSection,
  };
}

/** A sheet the run will not charge is closed as unpaid, once the person answers it. */
function closeUnpaid(sheet: EvidenceAppleSheet | null): void {
  if (sheet) void sheet.result.then(() => sheet.complete(false));
}

type Prepare = (buyer: EvidenceBuyer) => ReturnType<HomologacaoProductionEvidenceCardProps['onPrepare']>;

/** Which phase 1 a run starts with: a first run's, or a retry's of the latest run (FUT-5584); null when a retry cannot start. */
function phaseOne(props: HomologacaoProductionEvidenceCardProps, retry: readonly EvidenceRunSection[] | undefined): Prepare | null {
  if (!retry) return props.onPrepare;
  const runId = props.seller?.lastRunId;
  const prepareRetry = props.onPrepareRetry;
  return runId && prepareRetry ? (buyer) => prepareRetry(runId, buyer) : null;
}

interface RunContext {
  props: HomologacaoProductionEvidenceCardProps;
  form: ProductionForm;
  wallets: Pick<EvidenceWallets, 'collect' | 'reset'>;
  progress: ReturnType<typeof useRunProgress>;
  saved: (runId: string) => void;
  settle: (answer: ProductionRunAnswer) => void;
  setPix: (pix: ProductionPixView) => void;
  setPhase: (phase: Phase) => void;
  setFailed: (phase: EvidencePhase | null) => void;
  reset: () => void;
}

/**
 * A first run (`retry` absent), or a retry of the latest run raising only
 * these sections again in the same run (FUT-5584).
 */
function runOf(ctx: RunContext) {
  const { props, form, wallets, progress } = ctx;
  return async (appleSheet: EvidenceAppleSheet | null = null, retry?: readonly EvidenceRunSection[]): Promise<void> => {
    const buyer = buyerOf(form.buyer);
    const prepare = phaseOne(props, retry);
    if (!buyer || !prepare || !progress.begin()) return closeUnpaid(appleSheet);
    ctx.reset();
    rememberBuyer(form.buyer);
    let current: EvidencePhase = 'preparing';
    let runId: string | null = null;
    const enter = (next: EvidencePhase): void => {
      current = next;
      ctx.setPhase(next);
    };
    try {
      enter('preparing');
      const walletResults = wallets.collect();
      const prepared = await prepare(buyer);
      runId = prepared.runId;
      ctx.saved(prepared.runId);
      // The wallets' tokens are spent only once a run exists to spend them on.
      wallets.reset();
      enter(props.onChargeNow ? 'running' : 'encrypting');
      const { credit, debit } = form;
      const io = { props, prepared, buyer, credit, debit, walletResults, appleSheet, ...reporters(progress, enter) };
      ctx.settle(await raiseRunOrders(retry ? { ...io, retry } : io));
      form.clearCards();
    } catch {
      // A sheet still open when the run broke is closed as not charged.
      closeUnpaid(appleSheet);
      ctx.setFailed(current);
      // The run may have raised its Pix before its answer was lost: ask.
      if (runId) await props.onConfirmPix(runId, 'CHECK').then(ctx.setPix, () => undefined);
    } finally {
      ctx.setPhase('idle');
      progress.end(runId !== null);
      props.onRunEnded?.();
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
  const [failed, setFailed] = useState<EvidencePhase | null>(null);
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const { answered, setAnswered, saved, scenarios, ranAt } = useLatestRun(props.seller);
  const progress = useRunProgress();
  const { pix, setPix, skip, retryRefund, check, skipping, pixOpen } = useProductionPix(props);
  const run = runOf({
    props,
    form,
    wallets,
    progress,
    saved,
    setPix,
    setPhase,
    setFailed,
    settle: (answer) => {
      setAnswered({ scenarios: 'pix' in answer ? answer.scenarios : null });
      setPix('pix' in answer ? answer.pix : answer);
    },
    reset: () => {
      setConfirming(false);
      setFailed(null);
      setSummary(null);
    },
  });

  const download = useDownload(props.onDownload, setPhase, setFailed, setSummary);

  return {
    confirming,
    setConfirming,
    phase,
    progress,
    /** Everything runs at once (FUT-5519): the host fires what needs no card through `onChargeNow`. */
    parallel: props.onChargeNow !== undefined,
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
    /** Retry only these sections of the latest run (FUT-5584); offered only with the host's `onPrepareRetry`. */
    retry: (sections: readonly EvidenceRunSection[], appleSheet: EvidenceAppleSheet | null = null) => run(appleSheet, sections),
    canRetry: props.onPrepareRetry !== undefined && Boolean(props.seller?.lastRunId),
    download,
    skip,
    retryRefund,
    check,
  };
}
