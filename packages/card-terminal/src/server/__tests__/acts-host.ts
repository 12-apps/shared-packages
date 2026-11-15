import type { CaptureActs, CaptureLeg, RebindOutcome, RebindRecord, RefundCaptureInput, RefundOutcome, RefundRecord, SettledLeg } from '../capture-acts';
import type { CaptureExcess, ExcessPlan, ExcessRecord, ExcessSale, ExcessSettled, StoreCreditPort } from '../capture-excess';
import type { MemoryTerminalCaptures } from '../memory-store';

/**
 * A CALLER of the caller-driven acts, held in memory: a point of sale with its
 * settled sales and their legs, the cash it gives back, the credit wallet and
 * its own audit. It follows the documented steps — one transaction, the
 * engine's act on that handle, then its own writes from the answer — and
 * `transaction` puts all of it, and the capture rows, back as they were when
 * the work throws.
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
  credits: Array<{ clientId: string; orderId: string; amountCents: number; reason: string }>;
  records: Array<{ act: RefundRecord | RebindRecord | ExcessRecord; note: string }>;
}

/** The caller's own writes, each one statement of its own; spied on by the suites. */
export interface HostWrites {
  writeLegs(orderId: string, legs: ReadonlyArray<SettledLeg | CaptureLeg>): Promise<void>;
  bookCashBack(cash: CashBack, note: string): Promise<void>;
  bookCashRefund(refund: { clientId: string; orderId: string; amountCents: number }, note: string): Promise<void>;
  record(act: RefundRecord | RebindRecord | ExcessRecord, note: string): Promise<void>;
}

function snapshot(tables: Tables): Tables {
  return {
    sales: new Map([...tables.sales].map(([id, sale]) => [id, { ...sale, legs: [...sale.legs] }])),
    cashBack: [...tables.cashBack],
    cashRefunds: [...tables.cashRefunds],
    credits: [...tables.credits],
    records: [...tables.records],
  };
}

function restore(tables: Tables, from: Tables): void {
  tables.sales.clear();
  for (const [id, sale] of from.sales) tables.sales.set(id, sale);
  for (const key of ['cashBack', 'cashRefunds', 'credits', 'records'] as const) tables[key].splice(0, tables[key].length, ...(from[key] as never[]));
}

/** A refusal the caller cannot book: thrown to roll its transaction back, then answered. */
class Refused extends Error {
  constructor(readonly answer: Extract<ExcessSettled, { ok: false }>) {
    super(answer.code);
  }
}

export function actsHost(captures: MemoryTerminalCaptures) {
  const tables: Tables = { sales: new Map(), cashBack: [], cashRefunds: [], credits: [], records: [] };
  async function transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const before = snapshot(tables);
    try {
      return await captures.transaction(() => work(undefined));
    } catch (error) {
      restore(tables, before);
      throw error;
    }
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
  };
  const credit: StoreCreditPort<string> = {
    async post(posted) {
      tables.credits.push(posted);
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
  function rebind(acts: CaptureActs, input: { clientId: string; transactionCode: string; orderId: string }, note: string): Promise<RebindOutcome | { ok: false; code: 'NOT_A_SETTLED_SALE' }> {
    return transaction(async (tx) => {
      const sale = tables.sales.get(input.orderId);
      if (sale === undefined || sale.clientId !== input.clientId || !sale.paid) return { ok: false, code: 'NOT_A_SETTLED_SALE' } as const;
      const outcome = await acts.rebind({ ...input, paymentId: sale.paymentId, legs: [...sale.legs] }, tx);
      if (!outcome.ok || !outcome.moved) return outcome;
      await writes.writeLegs(input.orderId, outcome.legs);
      await writes.bookCashBack({ clientId: input.clientId, orderId: input.orderId, amountCents: outcome.cashBackCents, transactionCode: input.transactionCode }, note);
      await writes.record(outcome.record, note);
      return outcome;
    });
  }

  /** Excess: the engine's payment side on the caller's handle, then the caller's cash and audit. */
  async function settle(excess: CaptureExcess<unknown, string>, plan: ExcessPlan, sale: ExcessSale, note: string): Promise<ExcessSettled> {
    try {
      return await transaction(async (tx) => {
        const settled = await excess.settle(plan, sale, { tx, note });
        if (!settled.ok) throw new Refused(settled);
        if (settled.cashRefundCents > 0 && sale.orderId !== null) await writes.bookCashRefund({ clientId: sale.clientId, orderId: sale.orderId, amountCents: settled.cashRefundCents }, note);
        if (settled.record !== null) await writes.record(settled.record, note);
        return settled;
      });
    } catch (error) {
      if (error instanceof Refused) return error.answer;
      throw error;
    }
  }

  /** Whether the sale has an identified buyer: the caller's answer for `admitExcess`. */
  const buyerHoldsCredit = (orderId: string | null): boolean => orderId !== null && tables.sales.get(orderId)?.buyer === true;

  return { ...tables, writes, credit, refund, rebind, settle, buyerHoldsCredit };
}
