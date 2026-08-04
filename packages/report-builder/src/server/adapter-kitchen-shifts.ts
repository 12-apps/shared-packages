import {
  AUTO_END_REASON,
  COZINHA_ROUTE,
  END_REASON_LABELS,
  KITCHEN_RESOURCE_TYPE,
  KITCHEN_SHIFT_KIND,
  LINE_SELECT,
  MS_PER_SECOND,
  OPEN_SHIFT_LABEL,
  SECONDS_PER_HOUR,
  shiftOverlapWhere,
  UNASSIGNED_STATION,
  type KitchenReportSourceDb,
  type KitchenShiftSourceRow,
} from './adapter-kitchen-source';
import type { ReportWindow, SourceRow } from './adapter-shared';

/**
 * The Cozinha SHIFT fact (FUT-454) — the labour side of the análise, and the
 * denominator any productivity read needs.
 *
 * Three things it refuses to do, each of which would flatter the numbers:
 * it does not drop a CLOSED shift that produced nothing (the hour was still
 * paid for, and dropping it inflates lines-per-hour); it does not count a
 * shift's whole span when the shift straddles the window (hours are CLIPPED,
 * and the QUERY genuinely returns the straddling shift so there is something
 * to clip); and it does not hide an auto-closed shift's fabricated 16-hour
 * end — it LABELS it, so a reader can tell a swept shift from a worked one.
 */

interface ShiftOutput {
  lines: number;
  quantity: number;
}

async function shiftOutputs(
  db: KitchenReportSourceDb,
  clientId: string,
  shiftIds: readonly string[],
): Promise<Map<string, ShiftOutput>> {
  // `shift_id` is set-once, so these are the lines this shift OPENED work on —
  // including any it did not live to finish. Not window-clipped: they belong
  // to the shift, not to the period.
  //
  // Same line universe as every other block on the canvas (FUT-454): COZINHA
  // route, not canceled. `linhas_por_hora` divides by the shift's hours, so
  // counting a canceled or waiter line here would flatter the productivity
  // read with work the kitchen never plated.
  const lines = await db.kitchenTicketItem.findMany({
    where: {
      ticket: { clientId },
      route: COZINHA_ROUTE,
      canceledAt: null,
      shiftId: { in: [...shiftIds] },
    },
    select: LINE_SELECT,
  });
  const outputs = new Map<string, ShiftOutput>();
  for (const line of lines) {
    if (line.shiftId === null) continue;
    const current = outputs.get(line.shiftId) ?? { lines: 0, quantity: 0 };
    outputs.set(line.shiftId, {
      lines: current.lines + 1,
      quantity: current.quantity + line.quantity,
    });
  }
  return outputs;
}

function stationIdOf(shift: KitchenShiftSourceRow): string | null {
  return shift.resourceType === KITCHEN_RESOURCE_TYPE ? shift.resourceId : null;
}

async function stationNamesOf(
  db: KitchenReportSourceDb,
  shifts: readonly KitchenShiftSourceRow[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      shifts.flatMap((shift) => {
        const stationId = stationIdOf(shift);
        return stationId === null ? [] : [stationId];
      }),
    ),
  ];
  if (ids.length === 0) return new Map();
  const stations = await db.kitchenStation.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(stations.map((station) => [station.id, station.name]));
}

/**
 * Labour inside the report window only. A shift that straddles either edge is
 * CLIPPED rather than dropped or counted whole; an open shift is clipped at
 * the window's end. The `max` against `window.from` is live, not defensive:
 * the query returns shifts that BEGAN before the window (see
 * {@link shiftOverlapWhere}), and this is what stops their earlier hours from
 * being charged to this period.
 */
function clippedLaborSeconds(shift: KitchenShiftSourceRow, window: ReportWindow): number {
  const limit = window.toExclusive.getTime();
  const start = Math.max(shift.startedAt.getTime(), window.from.getTime());
  const end = Math.min(shift.endedAt?.getTime() ?? limit, limit);
  return Math.max(0, (end - start) / MS_PER_SECOND);
}

/** The station this shift was clocked into, `Sem estação` when it had none. */
function stationNameOf(
  shift: KitchenShiftSourceRow,
  stationNames: ReadonlyMap<string, string>,
): string {
  const stationId = stationIdOf(shift);
  if (stationId === null) return UNASSIGNED_STATION;
  return stationNames.get(stationId) ?? UNASSIGNED_STATION;
}

/** How the shift ended, in the reader's words — `Em aberto` while it has not. */
function endedReasonLabel(shift: KitchenShiftSourceRow): string {
  if (shift.endedAt === null || shift.endedReason === null) return OPEN_SHIFT_LABEL;
  return END_REASON_LABELS[shift.endedReason] ?? OPEN_SHIFT_LABEL;
}

function toShiftRow(
  shift: KitchenShiftSourceRow,
  window: ReportWindow,
  stationNames: ReadonlyMap<string, string>,
  outputs: ReadonlyMap<string, ShiftOutput>,
): SourceRow {
  const closed = shift.endedAt !== null;
  const autoClosed = shift.endedReason === AUTO_END_REASON;
  const laborSeconds = clippedLaborSeconds(shift, window);
  const produced = outputs.get(shift.id);
  return {
    // Deliberately NO `id` column. The shift id is the cook by another name
    // (one shift, one person), so it is neither a catalog dimension nor an
    // emitted fact — a row that does not carry it cannot be grouped by it even
    // if the catalog were to regain the field by accident.
    startedAt: shift.startedAt,
    stationName: stationNameOf(shift, stationNames),
    endedReason: endedReasonLabel(shift),
    // A 16h auto-close is a sweep, not a 16h shift. Labelled, never silently
    // dropped: the hours were still charged to the labour denominator.
    autoClosed,
    closed,
    shifts: 1,
    closedShifts: Number(closed),
    autoClosedShifts: Number(autoClosed),
    // A CLOSED shift that produced nothing still cost an hour and stays in the
    // denominator. An OPEN one is `null` — it has not finished producing.
    zeroOutputShifts: closed ? Number(produced === undefined) : null,
    laborSeconds,
    laborHours: laborSeconds / SECONDS_PER_HOUR,
    outputLines: produced?.lines ?? 0,
    outputQuantity: produced?.quantity ?? 0,
  };
}

/**
 * One kitchen shift that OVERLAPS the report window.
 *
 * It carries no cook NAME, but do not mistake that for anonymity: a shift is
 * one person's shift, so the shift id is the cook by another name. That is why
 * the id is neither a catalog dimension nor an emitted column (FUT-454) — the
 * finest grouping this entity offers is the station, the calendar day and how
 * the shift ended, none of which name anybody on their own. Labour hours exist
 * here as the DENOMINATOR of a productivity read; a per-person ranking belongs
 * on the line entity, where the timing measures carry their own floor.
 */
export async function fetchKitchenShifts(
  db: KitchenReportSourceDb,
  clientId: string,
  window: ReportWindow,
): Promise<SourceRow[]> {
  const shifts = await db.shift.findMany({
    where: shiftOverlapWhere(clientId, KITCHEN_SHIFT_KIND, window),
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      endedReason: true,
      resourceType: true,
      resourceId: true,
    },
  });
  if (shifts.length === 0) return [];
  const stationNames = await stationNamesOf(db, shifts);
  const outputs = await shiftOutputs(
    db,
    clientId,
    shifts.map((shift) => shift.id),
  );
  return shifts.map((shift) => toShiftRow(shift, window, stationNames, outputs));
}
