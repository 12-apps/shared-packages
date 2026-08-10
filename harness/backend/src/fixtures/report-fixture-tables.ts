/**
 * Every fixture entity's rows, scoped to the window the server resolved.
 *
 * This is the whole of what a HOST does between "the report asked for the last
 * thirty days" and "here are the rows": pick the entity's own date column and
 * apply the half-open window to it. A real host does the same thing in a
 * `where` clause; doing it in memory here is the only difference.
 */
import type { ReportWindow } from '@12-apps/report-builder/server';

import { HARNESS_CATALOG } from './report-catalog';
import { rowsInWindow, type FixtureRow } from './report-fixture-window';
import { KITCHEN_SHIFTS, KITCHEN_TICKET_ITEMS } from './report-kitchen-fixture';
import { ORDERS, ORDER_ITEMS, PAYMENTS } from './report-orders-fixture';
import { LOSS_EVENTS, STOCK_MOVEMENTS } from './report-stock-fixture';

const TABLES: Record<string, readonly FixtureRow[]> = {
  orders: ORDERS,
  order_items: ORDER_ITEMS,
  payments: PAYMENTS,
  stock_movements: STOCK_MOVEMENTS,
  loss_events: LOSS_EVENTS,
  kitchen_ticket_items: KITCHEN_TICKET_ITEMS,
  kitchen_shifts: KITCHEN_SHIFTS,
};

/**
 * The date field each entity is windowed on — the harness's own
 * `REPORT_ENTITY_DATE_FIELD`.
 *
 * It is not imported from the package, and the one divergence is why: there,
 * `loss_events` windows on `createdAt` because the losses are read off the
 * stock LEDGER, whose column is called that even though the entity exposes the
 * instant as `occurredAt`. The harness has no separate ledger column, so it
 * windows on the field the rows actually carry. Everything else matches,
 * including the kitchen's two — a cozinha line belongs to the period in which
 * the work FINISHED (`readyAt`), never the one it was ordered in.
 */
const DATE_FIELD: Record<string, string> = {
  orders: 'createdAt',
  order_items: 'createdAt',
  payments: 'createdAt',
  stock_movements: 'createdAt',
  loss_events: 'occurredAt',
  kitchen_ticket_items: 'readyAt',
  kitchen_shifts: 'startedAt',
};

/**
 * The catalog is the list of entities that must be served — reading the keys
 * off it rather than off `TABLES` means an entity added to the catalog with no
 * fixture behind it fails LOUDLY here, at the one place that could have
 * silently answered "no rows" for the rest of the harness's life.
 */
export function fixtureTables(window: ReportWindow): Record<string, FixtureRow[]> {
  return Object.fromEntries(
    Object.keys(HARNESS_CATALOG.entities).map((entity) => {
      const rows = TABLES[entity];
      const dateField = DATE_FIELD[entity];
      if (!rows || !dateField) {
        throw new Error(`Harness catalog declares "${entity}" with no fixture rows behind it.`);
      }
      return [entity, rowsInWindow(rows, dateField, window)];
    }),
  );
}
