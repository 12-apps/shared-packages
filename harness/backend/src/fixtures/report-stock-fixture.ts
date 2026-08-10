/**
 * The harness fixture's STOCK side: `stock_movements` and the `loss_events`
 * read off them.
 *
 * One ledger, two entities — which is the shape of the real thing (FUT-654).
 * `loss_events` is not a table: it is the subset of the ledger whose rows carry
 * a LOSS-axis reason, re-projected so "quantidade perdida" is a magnitude
 * rather than the negative delta the ledger stores. Deriving it here rather
 * than declaring a second list is what stops the two from disagreeing about a
 * loss the way two hand-written arrays always eventually do.
 *
 * The window ladder holds on both: today ⊂ 7 dias ⊂ 30 dias, strictly.
 */
import { saoPauloInstant, type FixtureRow } from './report-fixture-window';

/**
 * The six kinds `stock_movements.type` admits, spelled the way the DB CHECK
 * spells them. The catalog declares no closed set for `type`, so these are the
 * values a filter is typed against — a fixture that invented `ENTRADA` would
 * teach the reader the wrong vocabulary.
 */
type MovementType = 'RESTOCK' | 'SALE' | 'ADJUST' | 'SPOILAGE' | 'CONSUMPTION' | 'TRANSFER';

interface Movement {
  id: string;
  /** Local day and hour in São Paulo — the merchant's own clock. */
  day: string;
  hour: number;
  type: MovementType;
  itemName: string;
  quantityDelta: number;
  costCents: number;
  /**
   * The LOSS-axis reason attributed to this baixa, when there is one. Only a
   * row carrying one becomes a `loss_events` row: a negative delta with no
   * reason — a reconciliation, an opening balance — is deliberately NOT a loss,
   * and neither is a GAIN-axis reason (a surplus found is not a loss).
   */
  lossReason?: string;
}

const MOVEMENTS: readonly Movement[] = [
  // Three weeks back: the deep end of "30 dias" only.
  { id: 'm1', day: '2026-06-10', hour: 8, type: 'RESTOCK', itemName: 'Pão brioche', quantityDelta: 400, costCents: 32000 },
  { id: 'm2', day: '2026-06-12', hour: 15, type: 'SPOILAGE', itemName: 'Queijo cheddar', quantityDelta: -12, costCents: 2400, lossReason: 'Vencimento' },
  { id: 'm3', day: '2026-06-18', hour: 9, type: 'RESTOCK', itemName: 'Hambúrguer 180g', quantityDelta: 200, costCents: 90000 },
  { id: 'm4', day: '2026-06-22', hour: 19, type: 'ADJUST', itemName: 'Óleo de soja', quantityDelta: -4, costCents: 1600, lossReason: 'Quebra' },
  // Inside "7 dias", outside "Este mês".
  { id: 'm5', day: '2026-06-29', hour: 10, type: 'TRANSFER', itemName: 'Batata congelada', quantityDelta: -30, costCents: 4500 },
  { id: 'm6', day: '2026-06-30', hour: 11, type: 'SPOILAGE', itemName: 'Batata congelada', quantityDelta: -8, costCents: 1200, lossReason: 'Queimou no preparo' },
  // Month-to-date.
  { id: 'm7', day: '2026-07-01', hour: 8, type: 'RESTOCK', itemName: 'Queijo cheddar', quantityDelta: 120, costCents: 24000 },
  { id: 'm8', day: '2026-07-01', hour: 14, type: 'CONSUMPTION', itemName: 'Pão brioche', quantityDelta: -60, costCents: 4800 },
  { id: 'm9', day: '2026-07-02', hour: 12, type: 'SALE', itemName: 'Hambúrguer 180g', quantityDelta: -24, costCents: 10800 },
  { id: 'm10', day: '2026-07-02', hour: 16, type: 'ADJUST', itemName: 'Pão brioche', quantityDelta: -10, costCents: 800, lossReason: 'Devolução do cliente' },
  { id: 'm11', day: '2026-07-03', hour: 13, type: 'SPOILAGE', itemName: 'Hambúrguer 180g', quantityDelta: -6, costCents: 2700, lossReason: 'Vencimento' },
  { id: 'm12', day: '2026-07-04', hour: 9, type: 'RESTOCK', itemName: 'Óleo de soja', quantityDelta: 40, costCents: 16000 },
  { id: 'm13', day: '2026-07-04', hour: 18, type: 'SPOILAGE', itemName: 'Óleo de soja', quantityDelta: -3, costCents: 1200, lossReason: 'Queimou no preparo' },
  { id: 'm14', day: '2026-07-04', hour: 20, type: 'CONSUMPTION', itemName: 'Batata congelada', quantityDelta: -45, costCents: 6750 },
  // Today, before the frozen clock's 09:00.
  { id: 'm15', day: '2026-07-05', hour: 7, type: 'SALE', itemName: 'Queijo cheddar', quantityDelta: -18, costCents: 3600 },
  { id: 'm16', day: '2026-07-05', hour: 8, type: 'ADJUST', itemName: 'Batata congelada', quantityDelta: -5, costCents: 750, lossReason: 'Quebra' },
];

/** `stock_movements` — the whole ledger, minus the reason the entity never exposes. */
export const STOCK_MOVEMENTS: FixtureRow[] = MOVEMENTS.map((movement) => ({
  id: movement.id,
  createdAt: saoPauloInstant(movement.day, movement.hour),
  type: movement.type,
  itemName: movement.itemName,
  quantityDelta: movement.quantityDelta,
  costCents: movement.costCents,
}));

/**
 * `loss_events` — the ledger rows that name a loss reason, re-projected.
 *
 * The entity keeps `occurredAt` as its date field even though the ledger calls
 * that instant `createdAt`; the wire name is what saved reports already group
 * by, so it outlives the column it is read from.
 */
export const LOSS_EVENTS: FixtureRow[] = MOVEMENTS.filter(
  (movement) => movement.lossReason !== undefined,
).map((movement) => ({
  id: movement.id,
  occurredAt: saoPauloInstant(movement.day, movement.hour),
  reasonName: movement.lossReason ?? '',
  itemName: movement.itemName,
  // The ledger signs a baixa negative; "quantidade perdida" is a magnitude.
  quantity: -movement.quantityDelta,
  // Already the cost of the units actually drawn down — never re-multiplied.
  lossValueCents: movement.costCents,
}));
