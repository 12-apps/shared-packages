import {
  attributionOf,
  ATTRIBUTION_LABELS,
  COZINHA_ROUTE,
  LINE_SELECT,
  secondsBetween,
  UNASSIGNED_STATION,
  type KitchenLineSourceRow,
  type KitchenReportSourceDb,
} from './adapter-kitchen-source';
import { windowWhere, type ReportWindow, type SourceRow } from './adapter-shared';
import { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from './local-time';

/**
 * The Cozinha LINE fact (FUT-454) — one completed kitchen line, the grain the
 * whole análise is built on.
 *
 * Three invariants this module exists to hold, all easy to get subtly wrong
 * and impossible to notice afterwards:
 *
 * 1. **Unquoted history is EXCLUDED, never coerced to 0.** FUT-364 shipped
 *    plan anchors and diner quotes with no backfill, so every line sent before
 *    it has `plannedReadyAt IS NULL` and every ticket `dueAt IS NULL`. A
 *    missing anchor emits `null`, which `accumulate` skips without counting it
 *    toward `minSample`; a 0 would report a perfect on-time record for the
 *    whole pre-FUT-364 era.
 * 2. **The two lateness signals never mix.** `plan*` measures compare a LINE
 *    against the kitchen's own plan; `ticket*` measures compare a TICKET
 *    against what the diner was told. They are named apart so they cannot be
 *    confused at a glance, and the ticket-grain ones are emitted on exactly
 *    ONE representative line per ticket, so an average is a per-pedido average
 *    and not a per-line one.
 * 3. **Handoffs leave the individual ranking but not the report.** A line
 *    whose start and finish actors differ carries `chefId`/`chefName` as
 *    `null` — it cannot land in a per-cook group at all — while `handoffLines`
 *    keeps it visible as its own measure, because a handoff is a real
 *    operational signal rather than dirty data.
 */

/** The kitchen-PLAN signal: this line against its own `plannedReadyAt`. */
function planColumns(row: KitchenLineSourceRow): SourceRow {
  const plateLateness = secondsBetween(row.plannedReadyAt, row.readyAt);
  const planned = row.plannedReadyAt !== null;
  return {
    plannedLines: planned ? 1 : null,
    unplannedLines: planned ? 0 : 1,
    planLateLines: plateLateness === null ? null : Number(plateLateness > 0),
    planPlateLatenessSeconds: plateLateness,
    planFireLatenessSeconds: secondsBetween(row.plannedFireAt, row.startedAt),
    plannedPrepSeconds: secondsBetween(row.plannedFireAt, row.plannedReadyAt),
  };
}

function attributionColumns(row: KitchenLineSourceRow, chefName: string | null): SourceRow {
  const attribution = attributionOf(row);
  const attributed = attribution !== 'unattributed';
  const solo = attribution === 'solo';
  return {
    attribution: ATTRIBUTION_LABELS[attribution],
    chefId: solo ? row.startedById : null,
    chefName: solo ? chefName : null,
    attributedLines: attributed ? 1 : null,
    soloLines: attributed ? Number(solo) : null,
    handoffLines: attributed ? Number(attribution === 'handoff') : null,
    unattributedLines: attributed ? 0 : 1,
  };
}

const EMPTY_PROMISE: SourceRow = {
  ticketsCompleted: null,
  ticketsUnquoted: null,
  ticketsPromised: null,
  ticketsPromiseBroken: null,
  ticketPromiseLatenessSeconds: null,
};

/**
 * The DINER-PROMISE signal, at TICKET grain. Emitted only on the ticket's
 * representative line so `avg`/`p90`/`ratio` count each pedido once; every
 * other line of the same ticket carries nulls, which the accumulator skips.
 */
function promiseColumns(row: KitchenLineSourceRow, representative: boolean): SourceRow {
  if (!representative) return EMPTY_PROMISE;
  const { dueAt, deliveredAt } = row.ticket;
  // `due_at IS NULL` is UNQUOTED history, not an on-time pedido: it leaves the
  // promise population entirely instead of scoring zero seconds late.
  const lateness = dueAt === null ? null : secondsBetween(dueAt, deliveredAt);
  return {
    ticketsCompleted: 1,
    ticketsUnquoted: Number(dueAt === null),
    ticketsPromised: lateness === null ? null : 1,
    ticketsPromiseBroken: lateness === null ? null : Number(lateness > 0),
    ticketPromiseLatenessSeconds: lateness,
  };
}

/** Later `readyAt` wins; the id breaks ties so the choice is deterministic. */
function outranks(candidate: KitchenLineSourceRow, current: KitchenLineSourceRow): boolean {
  const a = candidate.readyAt?.getTime() ?? 0;
  const b = current.readyAt?.getTime() ?? 0;
  return a === b ? candidate.id > current.id : a > b;
}

function representativeLineIds(rows: readonly KitchenLineSourceRow[]): Set<string> {
  const best = new Map<string, KitchenLineSourceRow>();
  for (const row of rows) {
    const current = best.get(row.ticket.id);
    if (current === undefined || outranks(row, current)) best.set(row.ticket.id, row);
  }
  return new Set([...best.values()].map((row) => row.id));
}

function localHour(instant: Date | null): string | null {
  return instant === null ? null : hourOfDaySaoPaulo(instant);
}

function localWeekday(instant: Date | null): string | null {
  return instant === null ? null : dayOfWeekSaoPaulo(instant);
}

function toLineRow(
  row: KitchenLineSourceRow,
  chefNames: ReadonlyMap<string, string>,
  representatives: ReadonlySet<string>,
): SourceRow {
  // A deleted cook has no `users` row (neither actor column has an FK), so the
  // raw id stands in — anonymising them into a shared `null` bucket would pool
  // several people's lines into one group and defeat the suppression floor.
  const chefName =
    row.startedById === null ? null : (chefNames.get(row.startedById) ?? row.startedById);
  return {
    // Deliberately NO `id` column (FUT-454). A line id groups exactly one line,
    // which is exactly one cook's single observation; it has no analytical
    // value and every analytical use of it is a per-cook read in disguise.
    readyAt: row.readyAt,
    sentAt: row.ticket.sentAt,
    completionHourOfDay: localHour(row.readyAt),
    completionDayOfWeek: localWeekday(row.readyAt),
    demandHourOfDay: localHour(row.ticket.sentAt),
    demandDayOfWeek: localWeekday(row.ticket.sentAt),
    stationName: row.stationName ?? UNASSIGNED_STATION,
    productName: row.productName,
    lines: 1,
    quantity: row.quantity,
    // The two halves of "how long did this take", kept apart on purpose: the
    // QUEUE (demand arrived → someone picked it up) answers "do we have enough
    // people", the COOK (picked up → plated) answers "is it the dish or the
    // person". Added together they are a number that steers nothing.
    //
    // ONE timing observation per line, whatever the quantity: two portions of
    // the same dish were cooked once. Quantity scales throughput, not timing.
    waitSeconds: secondsBetween(row.ticket.sentAt, row.startedAt),
    prepSeconds: secondsBetween(row.startedAt, row.readyAt),
    ...planColumns(row),
    ...attributionColumns(row, chefName),
    ...promiseColumns(row, representatives.has(row.id)),
  };
}

async function chefNamesOf(
  db: KitchenReportSourceDb,
  rows: readonly KitchenLineSourceRow[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.startedById === null ? [] : [row.startedById]))),
  ];
  if (ids.length === 0) return new Map();
  // Neither actor column has an FK to `users`, so a deleted cook simply has no
  // row here and the line falls back to its raw id.
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.name ?? user.email]));
}

/**
 * One COMPLETED cozinha line, windowed on `readyAt` — "when did the work
 * finish". The demand instant (`sentAt`, "when did the demand arrive") rides
 * along as its own dimension precisely because it answers a different
 * question. GARCOM lines and NULL-route legacy rows are out: there is no
 * kitchen work to measure. Canceled lines are out: they were never plated.
 */
export async function fetchKitchenLines(
  db: KitchenReportSourceDb,
  clientId: string,
  window: ReportWindow,
): Promise<SourceRow[]> {
  const rows = await db.kitchenTicketItem.findMany({
    where: {
      ticket: { clientId },
      route: COZINHA_ROUTE,
      canceledAt: null,
      readyAt: windowWhere(window),
    },
    select: LINE_SELECT,
  });
  const chefNames = await chefNamesOf(db, rows);
  const representatives = representativeLineIds(rows);
  return rows.map((row) => toLineRow(row, chefNames, representatives));
}
