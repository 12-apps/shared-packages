import { executeCompiledQuery } from '../memory';
import type { CompiledQuery, ReportDataSource, ReportRow } from '../types';
import { fetchKitchenShifts } from './adapter-kitchen-shifts';
import type { KitchenReportSourceDb } from './adapter-kitchen-source';
import { fetchKitchenLines } from './adapter-kitchen';
import {
  windowWhere,
  type DateWindowWhere,
  type ReportWindow,
  type SourceRow,
} from './adapter-shared';
import { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from './local-time';
import { isLossReason, lossLedgerWhere } from './loss-predicate';

export type { ReportWindow };

/**
 * Future Pay's report DataSource (FUT-133/FUT-138), owned by the package and
 * duck-typed over the host's Prisma client (the payments-backend seam): the
 * host passes its generated client's delegates through the structural
 * {@link ReportSourceDb} interface, so this package never imports a generated
 * client. Rows fold through the library's reference executor, so adapter
 * semantics can never drift from the in-memory contract.
 *
 * Tenant scoping is non-negotiable: every fetcher puts `clientId` in the
 * `where` — a spec has no field that could widen it. The [from, toExclusive)
 * window applies at the database on each entity's date field.
 */

interface SoldLineRow {
  unitPriceCents: number;
  quantity: number;
}

interface OrderSourceRow {
  id: string;
  createdAt: Date;
  status: string;
  method: string;
  items: Array<SoldLineRow & { extras: SoldLineRow[] }>;
}

interface OrderItemSourceRow {
  id: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  costCents: number | null;
  order: { createdAt: Date };
  product: { category: { name: string } | null } | null;
  extras: SoldLineRow[];
}

interface PaymentSourceRow {
  id: string;
  createdAt: Date;
  method: string;
  status: string;
  amountCents: number;
}

interface StockMovementSourceRow {
  id: string;
  createdAt: Date;
  type: string;
  quantityDelta: number;
  costCents: number | null;
  /** Selected by the loss read only — the movements read leaves it out. */
  lossReasonId?: string | null;
  item: { name: string };
  /** The place joins are the movements read's; the loss read does not select them. */
  fromLocation?: { name: string } | null;
  toLocation?: { name: string } | null;
}

/** A taxonomy row as the loss read needs it: the label AND the GAIN/LOSS axis. */
interface LossReasonRow {
  id: string;
  name: string;
  kind: string;
}

/** The host client delegates this adapter reads — structural, never generated. */
export interface ReportSourceDb extends KitchenReportSourceDb {
  order: {
    findMany(args: {
      where: { clientId: string; createdAt: DateWindowWhere };
      select: {
        id: true;
        createdAt: true;
        status: true;
        method: true;
        items: {
          select: {
            unitPriceCents: true;
            quantity: true;
            extras: { select: { unitPriceCents: true; quantity: true } };
          };
        };
      };
    }): Promise<OrderSourceRow[]>;
  };
  orderItem: {
    findMany(args: {
      where: { order: { clientId: string; status: string; createdAt: DateWindowWhere } };
      select: {
        id: true;
        productName: true;
        quantity: true;
        unitPriceCents: true;
        costCents: true;
        order: { select: { createdAt: true } };
        product: { select: { category: { select: { name: true } } } };
        extras: { select: { unitPriceCents: true; quantity: true } };
      };
    }): Promise<OrderItemSourceRow[]>;
  };
  payment: {
    findMany(args: {
      where: { order: { clientId: string }; createdAt: DateWindowWhere };
      select: { id: true; createdAt: true; method: true; status: true; amountCents: true };
    }): Promise<PaymentSourceRow[]>;
  };
  stockMovement: {
    findMany(args: {
      // The movements read scopes to the tenant + window; the loss read adds
      // the sign + attribution halves of the canonical predicate.
      where: {
        clientId: string;
        canceledAt: null;
        createdAt: DateWindowWhere;
        quantityDelta?: { lt: number };
        lossReasonId?: { not: null };
      };
      select: {
        id: true;
        createdAt: true;
        type: true;
        quantityDelta: true;
        costCents: true;
        lossReasonId?: true;
        item: { select: { name: true } };
        fromLocation?: { select: { name: true } };
        toLocation?: { select: { name: true } };
      };
    }): Promise<StockMovementSourceRow[]>;
  };
  lossReason: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; kind: true };
    }): Promise<LossReasonRow[]>;
  };
}

/** Lazily resolves the host's client (mirrors the host's async singleton). */
export type ReportSourceDbProvider = () => Promise<ReportSourceDb>;

/** Revenue of one order/line set: unit price × quantity, plus paid extras. */
function soldRevenueCents(items: Array<SoldLineRow & { extras: SoldLineRow[] }>): number {
  return items.reduce(
    (total, item) =>
      total +
      item.unitPriceCents * item.quantity +
      item.extras.reduce((extras, extra) => extras + extra.unitPriceCents * extra.quantity, 0),
    0,
  );
}

async function fetchOrders(db: ReportSourceDb, clientId: string, window: ReportWindow): Promise<SourceRow[]> {
  const orders = await db.order.findMany({
    where: { clientId, createdAt: windowWhere(window) },
    select: {
      id: true,
      createdAt: true,
      status: true,
      method: true,
      items: {
        select: {
          unitPriceCents: true,
          quantity: true,
          extras: { select: { unitPriceCents: true, quantity: true } },
        },
      },
    },
  });
  return orders.map((order) => ({
    id: order.id,
    createdAt: order.createdAt,
    hourOfDay: hourOfDaySaoPaulo(order.createdAt),
    dayOfWeek: dayOfWeekSaoPaulo(order.createdAt),
    status: order.status,
    method: order.method,
    revenueCents: soldRevenueCents(order.items),
  }));
}

async function fetchOrderItems(db: ReportSourceDb, clientId: string, window: ReportWindow): Promise<SourceRow[]> {
  // "Itens vendidos" is sold lines only, by definition: PAID orders.
  const items = await db.orderItem.findMany({
    where: { order: { clientId, status: 'PAID', createdAt: windowWhere(window) } },
    select: {
      id: true,
      productName: true,
      quantity: true,
      unitPriceCents: true,
      costCents: true,
      order: { select: { createdAt: true } },
      product: { select: { category: { select: { name: true } } } },
      extras: { select: { unitPriceCents: true, quantity: true } },
    },
  });
  return items.map((item) => ({
    id: item.id,
    createdAt: item.order.createdAt,
    productName: item.productName,
    categoryName: item.product?.category?.name ?? 'Sem categoria',
    quantity: item.quantity,
    revenueCents: soldRevenueCents([item]),
    costCents: item.costCents,
  }));
}

async function fetchPayments(db: ReportSourceDb, clientId: string, window: ReportWindow): Promise<SourceRow[]> {
  const payments = await db.payment.findMany({
    where: { order: { clientId }, createdAt: windowWhere(window) },
    select: { id: true, createdAt: true, method: true, status: true, amountCents: true },
  });
  return payments.map((payment) => ({ ...payment }));
}

async function fetchStockMovements(db: ReportSourceDb, clientId: string, window: ReportWindow): Promise<SourceRow[]> {
  const movements = await db.stockMovement.findMany({
    where: { clientId, canceledAt: null, createdAt: windowWhere(window) },
    select: {
      id: true,
      createdAt: true,
      type: true,
      quantityDelta: true,
      costCents: true,
      item: { select: { name: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
    },
  });
  // FUT-312 interim for per-unit visibility: per-LOCATION dimensions inside
  // the tenant. Cross-unit (cross-tenant) reporting stays blocked — see
  // docs/cross-unit-reporting.md.
  return movements.map((movement) => ({
    id: movement.id,
    createdAt: movement.createdAt,
    type: movement.type,
    itemName: movement.item.name,
    fromLocationName: movement.fromLocation?.name ?? 'Sem local',
    toLocationName: movement.toLocation?.name ?? 'Sem local',
    quantityDelta: movement.quantityDelta,
    costCents: movement.costCents,
  }));
}

/**
 * Losses, read off the LEDGER rather than the `loss_events` table (FUT-654).
 *
 * The entity keeps its wire name `loss_events` so saved reports and the starter
 * spec that already reference it keep running — it names the reporting entity,
 * not the table behind it. The table itself is no longer read: it only ever saw
 * the losses recorded alongside a purchase/production entry, which made every
 * standalone Ajuste invisible here. See {@link lossLedgerWhere} for the full
 * reasoning and the measurements.
 */
async function fetchLossEvents(db: ReportSourceDb, clientId: string, window: ReportWindow): Promise<SourceRow[]> {
  const movements = await db.stockMovement.findMany({
    where: lossLedgerWhere(clientId, window),
    select: {
      id: true,
      createdAt: true,
      type: true,
      quantityDelta: true,
      costCents: true,
      lossReasonId: true,
      item: { select: { name: true } },
    },
  });
  // `StockMovement` holds a scalar FK to the taxonomy (no relation on a hot
  // model), so the GAIN/LOSS half of the predicate cannot ride in the `where`.
  const reasonIds = [...new Set(movements.map((movement) => movement.lossReasonId ?? ''))];
  const reasons = await db.lossReason.findMany({
    where: { id: { in: reasonIds } },
    select: { id: true, name: true, kind: true },
  });
  const byId = new Map(reasons.map((reason) => [reason.id, reason]));
  return movements
    .filter((movement) => isLossReason(byId.get(movement.lossReasonId ?? '')))
    .map((movement) => ({
      id: movement.id,
      // The entity's date field stays `occurredAt` on the wire; on the ledger
      // that instant is `createdAt`.
      occurredAt: movement.createdAt,
      reasonName: byId.get(movement.lossReasonId ?? '')?.name ?? 'Motivo removido',
      itemName: movement.item.name,
      // The ledger signs a loss negative; "quantidade perdida" is a magnitude.
      quantity: -movement.quantityDelta,
      // Already the cost of the units actually drawn down, at the cost of the
      // lots they came from — no re-multiplication by quantity.
      lossValueCents: movement.costCents,
    }));
}

const FETCHERS: Record<
  string,
  (db: ReportSourceDb, clientId: string, window: ReportWindow) => Promise<SourceRow[]>
> = {
  orders: fetchOrders,
  order_items: fetchOrderItems,
  payments: fetchPayments,
  stock_movements: fetchStockMovements,
  loss_events: fetchLossEvents,
  kitchen_ticket_items: fetchKitchenLines,
  kitchen_shifts: fetchKitchenShifts,
};

/** Build the tenant-scoped DataSource for one report execution window. */
export function createTenantReportDataSource(
  getDb: ReportSourceDbProvider,
  clientId: string,
  window: ReportWindow,
): ReportDataSource {
  return {
    async execute(query: CompiledQuery): Promise<ReportRow[]> {
      const fetcher = FETCHERS[query.entity];
      if (!fetcher) {
        // compileReport validates entities against the catalog first; this
        // guards catalog/adapter drift with a loud failure.
        throw new Error(`No report fetcher for entity "${query.entity}".`);
      }
      const rows = await fetcher(await getDb(), clientId, window);
      return executeCompiledQuery(rows, query);
    },
  };
}
