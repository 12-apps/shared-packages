import type { CaptureActPorts, CaptureActRecord, CaptureLeg, CashBack, SettledLeg } from '../capture-acts';
import type { CaptureExcessPorts, ExcessRecord } from '../capture-excess';
import type { MemoryTerminalCaptures } from '../memory-store';

/**
 * A host's tables behind the capture acts' and the excess's ports, held in
 * memory: the settled sales with their legs, the cash given back, the credit
 * posted and the record of each act. `transaction` puts all of it, and the
 * capture rows, back as they were when the work throws.
 */

interface HostSale {
  clientId: string;
  paymentId: string;
  paid: boolean;
  legs: Array<SettledLeg | CaptureLeg>;
  /** Whether the sale's buyer is an identified account. */
  buyer: boolean;
}

interface ActsHost {
  sales: Map<string, HostSale>;
  cashBack: CashBack[];
  cashRefunds: Array<{ clientId: string; orderId: string; amountCents: number }>;
  credits: Array<{ clientId: string; orderId: string; amountCents: number; reason: string }>;
  records: Array<{ act: CaptureActRecord | ExcessRecord; note: string }>;
  acts: CaptureActPorts<unknown, SettledLeg, string>;
  excess: CaptureExcessPorts<unknown, string>;
}

interface Tables {
  sales: Map<string, HostSale>;
  cashBack: CashBack[];
  cashRefunds: ActsHost['cashRefunds'];
  credits: ActsHost['credits'];
  records: ActsHost['records'];
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

export function actsHost(captures: MemoryTerminalCaptures): ActsHost {
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
  const acts: CaptureActPorts<unknown, SettledLeg, string> = {
    transaction,
    async settledSale(_tx, clientId, orderId) {
      const sale = tables.sales.get(orderId);
      if (sale === undefined || sale.clientId !== clientId || !sale.paid) return null;
      return { legs: sale.legs, paymentId: sale.paymentId };
    },
    async writeLegs(_tx, _clientId, orderId, legs) {
      const sale = tables.sales.get(orderId);
      if (sale) sale.legs = [...legs];
    },
    async bookCashBack(_tx, cash) {
      tables.cashBack.push(cash);
    },
    async record(_tx, act, note) {
      tables.records.push({ act, note });
    },
  };
  const excess: CaptureExcessPorts<unknown, string> = {
    transaction,
    async buyerHoldsCredit(_clientId, orderId) {
      return orderId !== null && tables.sales.get(orderId)?.buyer === true;
    },
    async bookCashRefund(_tx, refund) {
      tables.cashRefunds.push(refund);
    },
    async postCredit(credit) {
      tables.credits.push(credit);
    },
    async record(_tx, booked, note) {
      tables.records.push({ act: booked, note });
    },
  };
  return { ...tables, acts, excess };
}
