import type { DateWindowWhere } from './adapter-shared';

/**
 * The Cozinha read seam (FUT-454): the delegates the kitchen fetchers call,
 * the rows they get back, and the constants both of them agree on. Split from
 * the fetchers themselves so neither module has to import the other, and so
 * `catalog.ts`/`presets-kitchen.ts` can name the suppression floor without
 * pulling a fetcher into the MCP registry's offline import closure.
 */

/** Mirrors the host's `UNASSIGNED_STATION_NAME` (kitchen-operation.ts). */
export const UNASSIGNED_STATION = 'Sem estação';

/** `KitchenTicketItem.route` for work the cozinha itself does (vs. GARCOM). */
export const COZINHA_ROUTE = 'COZINHA';

/**
 * `Shift.kind` / `Shift.resourceType` for a cook's shift at a station. Spelled
 * here rather than imported from `@12-apps/shift`: this package must stay free of
 * that dependency, and `resourceType` is deliberately the bare `'kitchen'`.
 */
export const KITCHEN_SHIFT_KIND = 'kitchen';
export const KITCHEN_RESOURCE_TYPE = 'kitchen';

/** `Shift.endedReason` for the sweep that closes a shift nobody clocked out of. */
export const AUTO_END_REASON = 'auto';

/**
 * Eligible lines a cook needs before any per-cook figure is shown (FUT-454) —
 * declared on the catalog's identity dimensions, enforced by `compileReport`,
 * so the floor binds the dashboard, the CSV export, the HTTP API and the MCP
 * tool through the one code path they all share.
 */
export const KITCHEN_CHEF_MIN_SAMPLE = 20;

/** The `attribution` dimension value eligible for individual rankings. */
export const KITCHEN_ATTRIBUTION_SOLO = 'Individual';

export const ATTRIBUTION_LABELS = {
  solo: KITCHEN_ATTRIBUTION_SOLO,
  handoff: 'Repasse',
  unattributed: 'Sem atribuição',
} as const;

type Attribution = keyof typeof ATTRIBUTION_LABELS;

export const END_REASON_LABELS: Record<string, string> = {
  user: 'Cozinheiro',
  supervisor: 'Supervisor',
  auto: 'Automático',
};

export const OPEN_SHIFT_LABEL = 'Em aberto';

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_HOUR = 3600;

export interface KitchenLineSourceRow {
  id: string;
  productName: string;
  quantity: number;
  stationId: string | null;
  stationName: string | null;
  startedAt: Date | null;
  readyAt: Date | null;
  plannedFireAt: Date | null;
  plannedReadyAt: Date | null;
  startedById: string | null;
  finishedById: string | null;
  shiftId: string | null;
  ticket: { id: string; sentAt: Date | null; dueAt: Date | null; deliveredAt: Date | null };
}

export interface KitchenShiftSourceRow {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
  resourceType: string | null;
  resourceId: string | null;
}

interface NamedRow {
  id: string;
  name: string;
}

interface UserNameRow {
  id: string;
  name: string | null;
  email: string;
}

/**
 * One `select` shape for both line reads. `KitchenTicketItem` has no
 * `clientId` column, so every read tenant-guards through the ticket relation —
 * the house idiom (`lib/repositories/kitchen-line.ts`).
 */
interface KitchenLineSelect {
  id: true;
  productName: true;
  quantity: true;
  stationId: true;
  stationName: true;
  startedAt: true;
  readyAt: true;
  plannedFireAt: true;
  plannedReadyAt: true;
  startedById: true;
  finishedById: true;
  shiftId: true;
  ticket: { select: { id: true; sentAt: true; dueAt: true; deliveredAt: true } };
}

export const LINE_SELECT: KitchenLineSelect = {
  id: true,
  productName: true,
  quantity: true,
  stationId: true,
  stationName: true,
  startedAt: true,
  readyAt: true,
  plannedFireAt: true,
  plannedReadyAt: true,
  startedById: true,
  finishedById: true,
  shiftId: true,
  ticket: { select: { id: true, sentAt: true, dueAt: true, deliveredAt: true } },
};

/**
 * A shift belongs to the report window when it OVERLAPS it — it started
 * before the window ended, and it had not already ended when the window began
 * (an open shift never has). Windowing on `startedAt` alone would DROP the
 * evening shift that begins before `from`, which is precisely the shift whose
 * hours the window is trying to charge, and would leave the clipping in
 * `clippedLaborSeconds` unreachable on that edge.
 *
 * `startedAt` stays the anchor column — the one carrying the window's
 * exclusive bound, and the one `REPORT_ENTITY_DATE_FIELD` names.
 */
export interface ShiftOverlapWhere {
  clientId: string;
  kind: string;
  startedAt: { lt: Date };
  OR: Array<{ endedAt: null } | { endedAt: { gt: Date } }>;
}

/** Build the overlap predicate for one report window. */
export function shiftOverlapWhere(
  clientId: string,
  kind: string,
  window: { from: Date; toExclusive: Date },
): ShiftOverlapWhere {
  return {
    clientId,
    kind,
    startedAt: { lt: window.toExclusive },
    OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
  };
}

/** The host client delegates the kitchen fetchers read — structural, never generated. */
export interface KitchenReportSourceDb {
  kitchenTicketItem: {
    findMany(args: {
      where: {
        ticket: { clientId: string };
        route?: string;
        canceledAt?: null;
        readyAt?: DateWindowWhere;
        shiftId?: { in: string[] };
      };
      select: KitchenLineSelect;
    }): Promise<KitchenLineSourceRow[]>;
  };
  shift: {
    findMany(args: {
      where: ShiftOverlapWhere;
      select: {
        id: true;
        startedAt: true;
        endedAt: true;
        endedReason: true;
        resourceType: true;
        resourceId: true;
      };
    }): Promise<KitchenShiftSourceRow[]>;
  };
  kitchenStation: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<NamedRow[]>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; email: true };
    }): Promise<UserNameRow[]>;
  };
}

/** Signed seconds between two instants; `null` the moment either is missing. */
export function secondsBetween(from: Date | null, to: Date | null): number | null {
  if (from === null || to === null) return null;
  return (to.getTime() - from.getTime()) / MS_PER_SECOND;
}

/**
 * Three-way, never a bare `IS DISTINCT FROM`: both actor columns are nullable
 * for several unrelated reasons (legacy backfill, the QUEUED→READY shortcut),
 * and treating `(null, 'u1')` as a handoff would inflate that bucket with rows
 * that record no handoff at all.
 */
export function attributionOf(row: KitchenLineSourceRow): Attribution {
  if (row.startedById === null || row.finishedById === null) return 'unattributed';
  return row.startedById === row.finishedById ? 'solo' : 'handoff';
}
