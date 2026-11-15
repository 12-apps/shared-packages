import type { CaptureActs, CaptureLeg, RebindOutcome, RebindRecord, RefundCaptureInput, RefundOutcome, RefundRecord, SettledLeg } from '../capture-acts';
import type { CaptureExcess, ExcessCredit, ExcessPlan, ExcessRecord, ExcessSale, ExcessSettled } from '../capture-excess';
import type { MemoryTerminalCaptures } from '../memory-store';

/**
 * A CALLER of the caller-driven acts, held in memory: a point of sale with its
 * settled sales and their legs, the cash it gives back, its own audit, and a
 * credit wallet that keeps its OWN state (credit is posted after the caller's
 * commit, so a rollback never takes it back). It follows the documented steps
 * — one transaction holding the sale row's lock, the engine's act on that
 * handle, then its own writes from the answer — and `transaction` puts the
 * caller's tables and the capture rows back as they were when the work throws.
 *
 * Transactions run one at a time, as a sale row lock (`SELECT … FOR UPDATE`)
 * orders two writers of one sale; the memory store's rollback is a snapshot,
 * not isolation, so two unserialised transactions could undo each other.
 * `lock: false` on a rebind skips the lock to exercise the engine's own guard.
 */

interface HostSale {
  clientId: string;
  paymentId: string;
  paid: boolean;
  legs: Array<SettledLeg | CaptureLeg>;
  /** Whether the sale's buyer is an identified account. */
  buyer: boolean;
}

interface CashBack {
  clientId: string;
  orderId: string;
  amountCents: number;
  transactionCode: string;
}

interface Tables {
  sales: Map<string, HostSale>;
  cashBack: CashBack[];
  cashRefunds: Array<{ clientId: string; orderId: string; amountCents: number }>;
  records: Array<{ act: RefundRecord | RebindRecord | ExcessRecord; note: string }>;
}

/** The caller's own writes, each one statement of its own; spied on by the suites. */
interface HostWrites {
  writeLegs(orderId: string, legs: ReadonlyArray<SettledLeg | CaptureLeg>): Promise<void>;
  bookCashBack(cash: CashBack, note: string): Promise<void>;
  bookCashRefund(refund: { clientId: string; orderId: string; amountCents: number }, note: string): Promise<void>;
  record(act: RefundRecord | RebindRecord | ExcessRecord, note: string): Promise<void>;
  /** The wallet: outside every transaction, deduped on the credit's key. */
  postCredit(credit: ExcessCredit): Promise<void>;
}

function snapshot(tables: Tables): Tables {
  return {
    sales: new Map([...tables.sales].map(([id, sale]) => [id, { ...sale, legs: [...sale.legs] }])),
    cashBack: [...tables.cashBack],
    cashRefunds: [...tables.cashRefunds],
    records: [...tables.records],
  };
}

function restore(tables: Tables, from: Tables): void {
  tables.sales.clear();
  for (const [id, sale] of from.sales) tables.sales.set(id, sale);
  for (const key of ['cashBack', 'cashRefunds', 'records'] as const) tables[key].splice(0, tables[key].length, ...(from[key] as never[]));
}

/** A refusal the caller cannot book: thrown to roll its transaction back, then answered. */
class Refused extends Error {
  constructor(readonly answer: Extract<ExcessSettled, { ok: false }>) {
    super(answer.code);
  }
}

export function actsHost(captures: MemoryTerminalCaptures) {
  const tables: Tables = { sales: new Map(), cashBack: [], cashRefunds: [], records: [] };
  /** The wallet's own table, keyed by the credit's dedupe key: never rolled back with a caller transaction. */
  const wallet = new Map<string, ExcessCredit>();
  const order: Array<Promise<unknown>> = [];
  async function run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const before = snapshot(tables);
    try {
      return await captures.transaction(() => work('host-tx'));
    } catch (error) {
      restore(tables, before);
      throw error;
    }
  }
  /** One transaction; serialised behind the others unless `lock` is false. */
  function transaction<T>(work: (tx: unknown) => Promise<T>, lock = true): Promise<T> {
    if (!lock) return run(work);
    const next = (order[order.length - 1] ?? Promise.resolve()).then(() => run(work));
    order.push(next.catch(() => undefined));
    return next;
  }
  const writes: HostWrites = {
    async writeLegs(orderId, legs) {
      const sale = tables.sales.get(orderId);
      if (sale) sale.legs = [...legs];
    },
    async bookCashBack(cash) {
      tables.cashBack.push(cash);
    },
    async bookCashRefund(refund) {
      tables.cashRefunds.push(refund);
    },
    async record(act, note) {
      tables.records.push({ act, note });
    },
    async postCredit(credit) {
      if (!wallet.has(credit.dedupeKey)) wallet.set(credit.dedupeKey, credit);
    },
  };

  /** Refund: one transaction, the flag on its handle, the audit only when this act flagged. */
  function refund(acts: CaptureActs, input: RefundCaptureInput, note: string): Promise<RefundOutcome> {
    return transaction(async (tx) => {
      const outcome = await acts.refund(input, tx);
      if (outcome.ok && outcome.flagged) await writes.record(outcome.record, note);
      return outcome;
    });
  }

  /** Rebind: the caller reads its sale, the engine binds on the same handle, the caller writes what it answered. */
  function rebind(
    acts: CaptureActs,
    input: { clientId: string; transactionCode: string; orderId: string },
    note: string,
    options: { lock?: boolean } = {},
  ): Promise<RebindOutcome | { ok: false; code: 'NOT_A_SETTLED_SALE' }> {
    return transaction(async (tx) => {
      const sale = tables.sales.get(input.orderId);
      if (sale === undefined || sale.clientId !== input.clientId || !sale.paid) return { ok: false, code: 'NOT_A_SETTLED_SALE' } as const;
      const outcome = await acts.rebind({ ...input, paymentId: sale.paymentId, legs: [...sale.legs] }, tx);
      if (!outcome.ok || !outcome.moved) return outcome;
      await writes.writeLegs(input.orderId, outcome.legs);
      await writes.bookCashBack({ clientId: input.clientId, orderId: input.orderId, amountCents: outcome.cashBackCents, transactionCode: input.transactionCode }, note);
      await writes.record(outcome.record, note);
      return outcome;
    }, options.lock ?? true);
  }

  /** Excess: the engine's flags on the caller's handle, then the caller's cash and audit; the credit after the commit. */
  async function settle(
    excess: CaptureExcess,
    plan: ExcessPlan,
    sale: ExcessSale,
    note: string,
    options: { afterSettle?: () => Promise<void> } = {},
  ): Promise<ExcessSettled> {
    const settled = await transaction(async (tx) => {
      const answer = await excess.settle(plan, sale, tx);
      if (!answer.ok) throw new Refused(answer);
      if (answer.cashRefundCents > 0 && sale.orderId !== null) await writes.bookCashRefund({ clientId: sale.clientId, orderId: sale.orderId, amountCents: answer.cashRefundCents }, note);
      if (answer.record !== null) await writes.record(answer.record, note);
      await options.afterSettle?.();
      return answer;
    }).catch((error: unknown) => {
      if (error instanceof Refused) return error.answer;
      throw error;
    });
    if (settled.ok && settled.credit !== null) await writes.postCredit(settled.credit);
    return settled;
  }

  /** Whether the sale has an identified buyer: the caller's answer for `admitExcess`. */
  const buyerHoldsCredit = (orderId: string | null): boolean => orderId !== null && tables.sales.get(orderId)?.buyer === true;

  return { ...tables, wallet, writes, transaction, refund, rebind, settle, buyerHoldsCredit };
}
