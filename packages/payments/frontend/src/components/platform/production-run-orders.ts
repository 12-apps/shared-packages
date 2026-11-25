import type { BrowserCardResult, BrowserWalletResult, EvidenceBuyer, EvidenceRunSection } from '@12-apps/payments-backend';

import type { EvidenceAppleSheet } from './evidence-apple-sheet';
import type { HomologacaoProductionEvidenceCardProps, ProductionRunAnswer } from './HomologacaoProductionEvidenceCard';
import type { ProductionScenarioOutcome } from './ProductionScenarioList';
import { authenticateRealDebit, cardOf, encryptRealCard, isBlank, type CardForm } from './production-evidence-data';

/**
 * Raising a production run's orders once it is prepared (FUT-5519). With the
 * host's `onChargeNow`, everything that can run at once does (the owner:
 * "tudo em paralelo"; "google pay, pix e apple pay nao precisa esperar
 * criptografar, dispara imediato"): the Pix and Google Pay go out at once,
 * Apple Pay as soon as its sheet authorizes, while the browser encrypts the
 * cards; the credit and debit cards go as soon as they are ready. Each
 * section refunds on its own as soon as it is paid. Without it, the run is
 * the one phase 2 it always was.
 */

type Prepared = Awaited<ReturnType<HomologacaoProductionEvidenceCardProps['onPrepare']>>;
type Props = Pick<HomologacaoProductionEvidenceCardProps, 'onRun' | 'onChargeNow' | 'onChargeApplePay'>;
type OnSection = Parameters<HomologacaoProductionEvidenceCardProps['onRun']>[3];

interface RunIo {
  props: Props;
  prepared: Prepared;
  buyer: EvidenceBuyer;
  credit: CardForm;
  debit: CardForm;
  /** What the wallet presses gave, before this run. */
  walletResults: BrowserWalletResult[];
  /** Apple's sheet, opened in the confirm's tap; null when Apple Pay was not included. */
  appleSheet: EvidenceAppleSheet | null;
  /** The cards are ready (encrypted, the debit authenticated): the encrypt step's result. */
  onCards: (cards: readonly BrowserCardResult[]) => void;
  /** Outcomes known so far, from any section, merged by scenario. */
  onTold: (outcomes: readonly ProductionScenarioOutcome[]) => void;
  onSection: OnSection;
  /**
   * A retry of the latest run (FUT-5584): only these sections, raised again in
   * the same run. Absent: a first run, every section.
   */
  retry?: readonly EvidenceRunSection[];
}

/** Whether this run raises a section: always on a first run, only the named ones on a retry. */
const raises = (io: RunIo, section: EvidenceRunSection): boolean => !io.retry || io.retry.includes(section);

/** The cards the browser sends: the credit one always, the debit one unless it was left blank. */
async function browserCards(io: RunIo): Promise<BrowserCardResult[]> {
  const { prepared, credit, debit } = io;
  const holder = io.buyer.name;
  const cards: BrowserCardResult[] = [];
  const creditCard = raises(io, 'CARD') ? cardOf(credit) : null;
  if (creditCard) cards.push(await encryptRealCard('approved', creditCard, holder, prepared.publicKey));
  const debitCard = !raises(io, 'DEBIT') || isBlank(debit) ? null : cardOf(debit);
  if (debitCard) {
    cards.push(await authenticateRealDebit(debitCard, holder, prepared.publicKey, prepared.threeDSSession ?? null, prepared.debitTest));
  }
  return cards;
}

/** Why a wallet the run tried to charge at once was not charged: phase 2 records it. */
const notCharged = (result: BrowserWalletResult): BrowserWalletResult =>
  result.token ? { ...result, token: null, failure: 'TOKEN_ERROR' } : result;

/**
 * Apple Pay, charged while its sheet is open: wait for the person to
 * authorize, raise its order, close the sheet with PagBank's answer. Answers
 * what phase 2 still owes for Apple Pay: nothing once charged, else why not.
 */
async function chargeAppleInSheet(io: RunIo): Promise<BrowserWalletResult[]> {
  const { appleSheet: sheet, props, prepared, buyer } = io;
  if (!sheet) return [];
  const result = await sheet.result;
  if (!result.token || (!props.onChargeNow && !props.onChargeApplePay)) {
    sheet.complete(false);
    return [notCharged(result)];
  }
  const charging = props.onChargeNow
    ? props.onChargeNow(prepared.runId, { pix: false, wallets: [result], ...retryFlag(io) }, buyer).then((answer) => {
        io.onTold(answer.outcomes);
        return answer.paid.APPLE_PAY === true;
      })
    : props.onChargeApplePay!(prepared.runId, result, buyer).then((answer) => answer.paid);
  const paid = await charging.then(
    (value) => value,
    () => null,
  );
  sheet.complete(paid === true);
  // Not raised at all (the call failed): phase 2 records why, never a pressless pending.
  return paid === null ? [notCharged(result)] : [];
}

/** Pix and Google Pay, fired at once: answers what phase 2 still owes for them. */
async function chargePixAndGoogleNow(io: RunIo, google: BrowserWalletResult[]): Promise<EvidenceRunSection[]> {
  const pix = raises(io, 'PIX');
  if (!pix && google.length === 0) return [];
  const answer = await io.props.onChargeNow!(io.prepared.runId, { pix, wallets: google, ...retryFlag(io) }, io.buyer).then(
    (value) => value,
    () => null,
  );
  if (!answer) return [...(pix ? (['PIX'] as const) : []), ...google.map((wallet) => wallet.type)];
  io.onTold(answer.outcomes);
  return [];
}

/** The flag a retry's calls carry, so the server raises again what it would otherwise refuse as raised. */
const retryFlag = (io: RunIo): { retry?: true } => (io.retry ? { retry: true } : {});

/** Every order of the run, everything that can at once; answers the host's run answer. */
export async function raiseRunOrders(io: RunIo): Promise<ProductionRunAnswer> {
  const { props, prepared, buyer } = io;
  if (!props.onChargeNow) {
    const sheetOwes = await chargeAppleInSheet(io);
    const cards = await browserCards(io);
    io.onCards(cards);
    return props.onRun(prepared.runId, cards, [...io.walletResults, ...sheetOwes], io.onSection, buyer);
  }
  const walletResults = io.walletResults.filter((wallet) => raises(io, wallet.type));
  const google = walletResults.filter((wallet) => wallet.type === 'GOOGLE_PAY' && wallet.token);
  // A retry raises only the wallets pressed for it: an unpressed one stays as the first run left it.
  const unpressed = io.retry ? [] : walletResults.filter((wallet) => !google.includes(wallet));
  const [owedNow, sheetOwes, cards] = await Promise.all([
    chargePixAndGoogleNow(io, google),
    chargeAppleInSheet(io),
    browserCards(io).then((ready) => {
      io.onCards(ready);
      return ready;
    }),
  ]);
  const leftover = [...unpressed, ...sheetOwes];
  const cardSections = (['CARD', 'DEBIT'] as const).filter((section) => raises(io, section));
  const sections: EvidenceRunSection[] = [...cardSections, ...owedNow, ...leftover.map((wallet) => wallet.type)];
  // Google's token rides along again when its immediate charge failed: phase 2 then raises it.
  const wallets = owedNow.includes('GOOGLE_PAY') ? [...google, ...leftover] : leftover;
  if (io.retry) {
    // Nothing left for phase 2 (a Pix or wallet-only retry): the answer is the run as the server reads it now.
    if (sections.length === 0) return props.onRun(prepared.runId, [], [], io.onSection, buyer, [], { retry: true });
    return props.onRun(prepared.runId, cards, wallets, io.onSection, buyer, sections, { retry: true });
  }
  return props.onRun(prepared.runId, cards, wallets, io.onSection, buyer, sections);
}
