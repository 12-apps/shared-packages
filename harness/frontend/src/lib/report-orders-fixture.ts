/**
 * The harness fixture's SALES side: `orders`, `order_items` and `payments`.
 *
 * Three entities in one module because they are one world. An order's revenue
 * is the sum of its own lines, `order_items` is those lines for the orders
 * that were PAID, and a payment is the charge that settled one — exactly the
 * relationships `server/adapter.ts` reads out of Prisma. Declaring the three
 * independently would let "Receita por dia" and "Produtos mais vendidos"
 * disagree about the same day, which is the one thing an acceptance fixture
 * must not do.
 *
 * Only the ORDERS are hand-dated. Everything else is derived from them, so a
 * date moved here moves the whole world with it.
 */
import { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from '@12-apps/report-builder/server';

import type { FixtureRow } from './report-fixture-window';

/** What the store sells, at what price, at what cost. */
interface Product {
  category: string;
  priceCents: number;
  costCents: number;
}

/**
 * Twelve products on purpose. The "Produtos mais vendidos" template is a
 * top-TEN, so twelve is what makes the eleventh and twelfth fold into the
 * "Outros" bucket — the behaviour that keeps a truncated chart adding up to
 * the report's own total, and which a fixture with five products can never
 * show.
 */
const PRODUCTS: Record<string, Product> = {
  'Pastel de queijo': { category: 'Salgados', priceCents: 700, costCents: 250 },
  Coxinha: { category: 'Salgados', priceCents: 600, costCents: 220 },
  'Pão de queijo': { category: 'Salgados', priceCents: 500, costCents: 180 },
  'X-Burger': { category: 'Lanches', priceCents: 2200, costCents: 900 },
  'X-Salada': { category: 'Lanches', priceCents: 2500, costCents: 1000 },
  'Batata frita': { category: 'Porções', priceCents: 1500, costCents: 500 },
  'Onion rings': { category: 'Porções', priceCents: 1700, costCents: 600 },
  'Guaraná lata': { category: 'Bebidas', priceCents: 600, costCents: 250 },
  'Suco de laranja': { category: 'Bebidas', priceCents: 900, costCents: 350 },
  'Café expresso': { category: 'Bebidas', priceCents: 400, costCents: 120 },
  Pudim: { category: 'Sobremesas', priceCents: 800, costCents: 300 },
  Brownie: { category: 'Sobremesas', priceCents: 1000, costCents: 400 },
};

/** A product the fixture names must exist — a typo is a bug, not an empty bar. */
function productOf(name: string): Product {
  const product = PRODUCTS[name];
  if (!product) throw new Error(`Fixture names an unknown product: ${name}`);
  return product;
}

interface Line {
  orderId: string;
  product: string;
  quantity: number;
}

/** Every line of every order, PAID or not — an order has items either way. */
const LINES: readonly Line[] = [
  { orderId: 'o7', product: 'Suco de laranja', quantity: 1 },
  { orderId: 'o7', product: 'Coxinha', quantity: 2 },
  { orderId: 'o8', product: 'Onion rings', quantity: 1 },
  { orderId: 'o8', product: 'Guaraná lata', quantity: 2 },
  { orderId: 'o1', product: 'Brownie', quantity: 1 },
  { orderId: 'o1', product: 'Café expresso', quantity: 2 },
  { orderId: 'o2', product: 'X-Salada', quantity: 1 },
  { orderId: 'o2', product: 'Batata frita', quantity: 1 },
  { orderId: 'o3', product: 'X-Burger', quantity: 1 },
  { orderId: 'o3', product: 'Pão de queijo', quantity: 2 },
  { orderId: 'o9', product: 'Batata frita', quantity: 1 },
  { orderId: 'o4', product: 'Pastel de queijo', quantity: 2 },
  { orderId: 'o5', product: 'X-Burger', quantity: 2 },
  { orderId: 'o5', product: 'Batata frita', quantity: 1 },
  { orderId: 'o5', product: 'Guaraná lata', quantity: 1 },
  { orderId: 'o6', product: 'Pudim', quantity: 1 },
  { orderId: 'o6', product: 'Pastel de queijo', quantity: 1 },
  { orderId: 'o6', product: 'Café expresso', quantity: 1 },
];

interface OrderFact {
  id: string;
  createdAt: string;
  method: string;
  status: string;
}

/**
 * The orders, laid out so every preset VISIBLY differs.
 *
 * The local days are: `o6` today, `o1`–`o5` and `o9` across the four days
 * before it, `o8` on the last day of JUNE, and `o7` a fortnight back. Counted
 * as day buckets, each preset therefore returns a different number — the only
 * arrangement in which the toggle can be seen to work at all:
 *
 *   hoje 1  ⊂  este mês 4  ⊂  7 dias 5  ⊂  30 dias 6
 *
 * `o8` is what makes `Este mês` distinguishable (FUT-755). Without it the
 * month-to-date window and `7 dias` cover the same four days, so the new pill
 * could resolve to either and this fixture could not tell them apart. Note the
 * ORDER too: month-to-date is NARROWER than seven days for the first week of
 * every month, which is why `Este mês` is not a rung on the empty state's
 * widening ladder.
 *
 * `o3` is 02:00Z, which is 23:00 on the PREVIOUS local day, and `o9` shares
 * `o1`'s bucket — an order added to an existing day changes no count, which is
 * how the AWAITING_PAYMENT status got a row without disturbing the ladder.
 */
const ORDER_FACTS: readonly OrderFact[] = [
  { id: 'o7', createdAt: '2026-06-20T15:00:00Z', method: 'CARD', status: 'PAID' },
  // 30 June, 12:00 in São Paulo — inside "7 dias", outside "Este mês".
  { id: 'o8', createdAt: '2026-06-30T15:00:00Z', method: 'PIX', status: 'PAID' },
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', status: 'PAID' },
  { id: 'o2', createdAt: '2026-07-01T14:00:00Z', method: 'CARD', status: 'PAID' },
  { id: 'o9', createdAt: '2026-07-01T18:00:00Z', method: 'PIX', status: 'AWAITING_PAYMENT' },
  { id: 'o3', createdAt: '2026-07-02T02:00:00Z', method: 'PIX', status: 'PAID' },
  { id: 'o4', createdAt: '2026-07-03T09:00:00Z', method: 'WAITER', status: 'FAILED' },
  { id: 'o5', createdAt: '2026-07-04T20:00:00Z', method: 'CARD', status: 'PAID' },
  { id: 'o6', createdAt: '2026-07-05T13:00:00Z', method: 'PIX', status: 'PAID' },
];

const linesOf = (orderId: string): Line[] => LINES.filter((line) => line.orderId === orderId);

const lineRevenue = (line: Line): number => line.quantity * productOf(line.product).priceCents;

const revenueOf = (orderId: string): number =>
  linesOf(orderId).reduce((total, line) => total + lineRevenue(line), 0);

/**
 * `orders`.
 *
 * `revenueCents` sums the order's own lines — the same formula the real
 * adapter applies — for EVERY order, whatever its status. A failed order still
 * has items; what excludes it from a revenue report is the `status = PAID`
 * filter the starter carries, not a hole in the data.
 *
 * `hourOfDay` and `dayOfWeek` are DERIVED here with the package's own
 * `local-time` helpers, so the encodings ("09", "1-seg") that make them sort
 * correctly as strings cannot drift from the ones the product produces.
 */
export const ORDERS: FixtureRow[] = ORDER_FACTS.map((order) => ({
  id: order.id,
  createdAt: order.createdAt,
  hourOfDay: hourOfDaySaoPaulo(new Date(order.createdAt)),
  dayOfWeek: dayOfWeekSaoPaulo(new Date(order.createdAt)),
  status: order.status,
  method: order.method,
  revenueCents: revenueOf(order.id),
}));

/**
 * `order_items` — "Itens vendidos" is sold lines only, by definition: the
 * lines of PAID orders. `o4` (falhou) and `o9` (aguardando) keep their lines
 * in the world above and are absent here, which is exactly the difference the
 * real adapter's `status: 'PAID'` predicate makes.
 */
export const ORDER_ITEMS: FixtureRow[] = ORDER_FACTS.filter(
  (order) => order.status === 'PAID',
).flatMap((order) =>
  linesOf(order.id).map((line, index) => {
    const product = productOf(line.product);
    return {
      id: `${order.id}-i${index + 1}`,
      createdAt: order.createdAt,
      productName: line.product,
      categoryName: product.category,
      quantity: line.quantity,
      revenueCents: lineRevenue(line),
      costCents: line.quantity * product.costCents,
    };
  }),
);

/** Which order each charge settled, in which state, and how long after it. */
const CHARGES: ReadonlyArray<{ orderId: string; status: string; afterSeconds?: number }> = [
  // A card hold and its capture: two rows on one order, which is why the
  // preset filters `status = PAID` rather than summing everything.
  { orderId: 'o7', status: 'AUTHORIZED' },
  { orderId: 'o7', status: 'PAID', afterSeconds: 120 },
  { orderId: 'o8', status: 'PAID' },
  { orderId: 'o1', status: 'PAID' },
  { orderId: 'o2', status: 'PAID' },
  { orderId: 'o3', status: 'PAID' },
  // The order is still AWAITING_PAYMENT, so its charge is still PENDING.
  { orderId: 'o9', status: 'PENDING' },
  // A refused attempt and the retry that worked.
  { orderId: 'o5', status: 'DECLINED' },
  { orderId: 'o5', status: 'PAID', afterSeconds: 180 },
  { orderId: 'o6', status: 'PAID' },
  // `o4` has none: WAITER settles an ORDER and never takes a charge, which is
  // why `payments.method` has no such value.
];

const orderFact = (orderId: string): OrderFact => {
  const order = ORDER_FACTS.find((candidate) => candidate.id === orderId);
  if (!order) throw new Error(`Fixture charges an unknown order: ${orderId}`);
  return order;
};

const chargedAt = (instant: string, afterSeconds: number): string =>
  new Date(Date.parse(instant) + afterSeconds * 1000).toISOString();

/**
 * A charge's method is the order's, minus the one that cannot be charged. It
 * throws rather than substituting: silently rewriting WAITER to PIX would put a
 * value in `payments.method` that its own closed set does not contain, and the
 * builder would offer a filter matching a row nobody can explain.
 */
const chargeMethod = (order: OrderFact): string => {
  if (order.method === 'WAITER') {
    throw new Error(`WAITER settles order ${order.id} without ever taking a charge.`);
  }
  return order.method;
};

/**
 * `payments` — the charges, whose method and status sets are deliberately NOT
 * the order's: a charge is only ever online (no WAITER) and it has a lifecycle
 * of its own (AUTHORIZED, DECLINED).
 */
export const PAYMENTS: FixtureRow[] = CHARGES.map((charge, index) => {
  const order = orderFact(charge.orderId);
  return {
    id: `pay${index + 1}`,
    createdAt: chargedAt(order.createdAt, charge.afterSeconds ?? 0),
    method: chargeMethod(order),
    status: charge.status,
    amountCents: revenueOf(charge.orderId),
  };
});
