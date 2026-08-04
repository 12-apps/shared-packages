import {
  createMemoryDataSource,
  formatReportValue,
  runReport,
  SUPPRESSED,
  SUPPRESSED_PLACEHOLDER,
  type ReportRow,
  type ReportSpecInput,
} from "../../index";
import { describe, expect, it } from "vitest";

import { fetchKitchenLines } from "../adapter-kitchen";
import { fetchKitchenShifts } from "../adapter-kitchen-shifts";
import {
  COZINHA_ROUTE,
  KITCHEN_ATTRIBUTION_SOLO,
  KITCHEN_CHEF_MIN_SAMPLE,
  type KitchenLineSourceRow,
  type KitchenReportSourceDb,
  type KitchenShiftSourceRow,
  type ShiftOverlapWhere,
} from "../adapter-kitchen-source";
import { reportCatalog } from "../catalog";
import { getSystemReport } from "../presets";

/**
 * The Cozinha análise stands or falls on four things being right, and each of
 * them fails SILENTLY when it is wrong — the report still renders, it just
 * lies. So each has its own test here:
 *
 *   - unquoted history is EXCLUDED from the rate, never scored as on-time;
 *   - the kitchen-plan signal and the diner-promise signal stay apart, and the
 *     promise is counted once per PEDIDO rather than once per line;
 *   - a handoff leaves the individual ranking but stays in the report;
 *   - a per-cook figure below the floor cannot be computed at all.
 */

const CLIENT_ID = "client-1";
const WINDOW = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  toExclusive: new Date("2026-07-08T00:00:00.000Z"),
};

const BASE_LINE: KitchenLineSourceRow = {
  id: "line-1",
  productName: "Picanha",
  quantity: 1,
  stationId: "st-1",
  stationName: "Grelha",
  startedAt: new Date("2026-07-02T12:00:00.000Z"),
  readyAt: new Date("2026-07-02T12:10:00.000Z"),
  plannedFireAt: new Date("2026-07-02T12:00:00.000Z"),
  plannedReadyAt: new Date("2026-07-02T12:08:00.000Z"),
  startedById: "cook-a",
  finishedById: "cook-a",
  shiftId: "shift-1",
  ticket: {
    id: "ticket-1",
    sentAt: new Date("2026-07-02T11:55:00.000Z"),
    dueAt: new Date("2026-07-02T12:15:00.000Z"),
    deliveredAt: new Date("2026-07-02T12:20:00.000Z"),
  },
};

/**
 * A fixture line, plus the two columns the fetchers filter on but never
 * SELECT (`route`, `canceledAt`). They are absent from the source row for that
 * reason; the fake needs them to apply the same narrowing the database would.
 * Both default to "an ordinary kitchen line" so every existing fixture is
 * unaffected.
 */
type FakeLine = KitchenLineSourceRow & { route?: string; canceledAt?: Date | null };

type LineOverrides = Partial<Omit<FakeLine, "ticket">> & {
  ticket?: Partial<KitchenLineSourceRow["ticket"]>;
};

function line(overrides: LineOverrides): FakeLine {
  return { ...BASE_LINE, ...overrides, ticket: { ...BASE_LINE.ticket, ...overrides.ticket } };
}

interface DbCall {
  where: Record<string, unknown>;
}

interface FakeDb extends KitchenReportSourceDb {
  lineCalls: DbCall[];
  shiftCalls: DbCall[];
}

/**
 * Applies the fetcher's OWN overlap predicate rather than returning every
 * fixture row. A fake that ignores its `where` cannot tell a query that drops
 * a straddling shift from one that keeps it, which is exactly the bug the
 * window tests are here to catch.
 */
function matchesShiftWhere(shift: KitchenShiftSourceRow, where: ShiftOverlapWhere): boolean {
  if (shift.startedAt.getTime() >= where.startedAt.lt.getTime()) return false;
  // Honours a lower bound on `startedAt` too, even though the fetcher must not
  // set one: a fake that quietly ignores a predicate cannot fail when the
  // fetcher regains it, and re-adding `gte: window.from` here is exactly how
  // the straddling-shift bug comes back.
  const lowerBound = (where.startedAt as { gte?: Date }).gte;
  if (lowerBound && shift.startedAt.getTime() < lowerBound.getTime()) return false;
  return where.OR.some((clause) =>
    clause.endedAt === null
      ? shift.endedAt === null
      : shift.endedAt !== null && shift.endedAt.getTime() > clause.endedAt.gt.getTime(),
  );
}

function fakeDb(
  lines: readonly FakeLine[],
  shifts: readonly KitchenShiftSourceRow[] = [],
): FakeDb {
  const lineCalls: DbCall[] = [];
  const shiftCalls: DbCall[] = [];
  return {
    lineCalls,
    shiftCalls,
    kitchenTicketItem: {
      findMany: (args) => {
        lineCalls.push({ where: args.where as unknown as Record<string, unknown> });
        const ids = args.where.shiftId?.in;
        if (ids === undefined) return Promise.resolve([...lines]);
        // The shift path's line read narrows on route and cancellation too, and
        // a fake that ignored those could not tell `outputLines` counting the
        // kitchen's own work from it counting every line on the ticket.
        return Promise.resolve(
          lines.filter(
            (row) =>
              row.shiftId !== null &&
              ids.includes(row.shiftId) &&
              (args.where.route === undefined || (row.route ?? COZINHA_ROUTE) === args.where.route) &&
              (args.where.canceledAt === undefined || (row.canceledAt ?? null) === null),
          ),
        );
      },
    },
    shift: {
      findMany: (args) => {
        shiftCalls.push({ where: args.where as unknown as Record<string, unknown> });
        return Promise.resolve(shifts.filter((shift) => matchesShiftWhere(shift, args.where)));
      },
    },
    kitchenStation: {
      findMany: () => Promise.resolve([{ id: "st-1", name: "Grelha" }]),
    },
    user: {
      findMany: () =>
        Promise.resolve([
          { id: "cook-a", name: "Ana", email: "ana@x.com" },
          { id: "cook-b", name: null, email: "bruno@x.com" },
        ]),
    },
  };
}

async function lineRows(lines: readonly FakeLine[]): Promise<ReportRow[]> {
  const facts = await fetchKitchenLines(fakeDb(lines), CLIENT_ID, WINDOW);
  return facts as ReportRow[];
}

async function run(spec: ReportSpecInput, sourceRows: ReportRow[]) {
  return await runReport(spec, {
    catalog: reportCatalog,
    adapter: createMemoryDataSource({
      kitchen_ticket_items: sourceRows,
      kitchen_shifts: sourceRows,
    }),
  });
}

describe("kitchen line facts", () => {
  it("windows on readyAt and refuses GARCOM, legacy-route and canceled lines", async () => {
    const db = fakeDb([BASE_LINE]);
    await fetchKitchenLines(db, CLIENT_ID, WINDOW);
    expect(db.lineCalls[0]?.where).toEqual({
      ticket: { clientId: CLIENT_ID },
      // `route = 'COZINHA'` and not "not GARCOM": the latter sweeps every
      // NULL-route legacy row back in.
      route: "COZINHA",
      canceledAt: null,
      readyAt: { gte: WINDOW.from, lt: WINDOW.toExclusive },
    });
  });

  it("keeps sentAt as its own dimension, distinct from the completion window", async () => {
    const [row] = await lineRows([BASE_LINE]);
    expect(row?.readyAt).toEqual(BASE_LINE.readyAt);
    expect(row?.sentAt).toEqual(BASE_LINE.ticket.sentAt);
    // 12:10 UTC is 09h in São Paulo; the demand arrived at 11:55 UTC = 08h.
    expect(row?.completionHourOfDay).toBe("09");
    expect(row?.demandHourOfDay).toBe("08");
  });

  it("times a line once whatever the quantity, but counts every unit produced", async () => {
    const [row] = await lineRows([line({ quantity: 4 })]);
    expect(row?.prepSeconds).toBe(600);
    expect(row?.lines).toBe(1);
    expect(row?.quantity).toBe(4);
  });

  /**
   * The ticket's headline requirement: WAIT and COOK, separately.
   *
   * They answer different questions — a long queue is a staffing answer, a long
   * cook is a dish-or-person answer — and neither is recoverable from their sum
   * afterwards, which is why one "tempo total" column would have been useless.
   */
  it("splits the queue wait from the cook time, and never conflates the two", async () => {
    // Sent 11:55, picked up 12:00, plated 12:10: five minutes in the queue,
    // ten at the pass.
    const [row] = await lineRows([BASE_LINE]);
    expect(row?.waitSeconds).toBe(300);
    expect(row?.prepSeconds).toBe(600);
    expect(row?.waitSeconds).not.toBe(row?.prepSeconds);
  });

  it("measures the wait from the DEMAND, not from the kitchen's plan", async () => {
    // The plan said fire at 12:00 and the cook did — plan lateness is zero,
    // and the five minutes the diner spent waiting are still five minutes.
    const [row] = await lineRows([BASE_LINE]);
    expect(row?.planFireLatenessSeconds).toBe(0);
    expect(row?.waitSeconds).toBe(300);
  });

  it("leaves both tempos empty when nobody registered the start", async () => {
    // READY is reachable straight from QUEUED, so this is a live row, not dirt.
    // Neither half exists without a start instant — and a 0 would read as
    // "instant service" on exactly the lines nobody timed.
    const [row] = await lineRows([line({ startedAt: null, startedById: null })]);
    expect(row?.prepSeconds).toBeNull();
    expect(row?.waitSeconds).toBeNull();
  });

  it("leaves the wait empty on a line whose ticket was never sent", async () => {
    const [row] = await lineRows([line({ ticket: { sentAt: null } })]);
    expect(row?.waitSeconds).toBeNull();
    // The cook time is unaffected: the two are measured from different ends.
    expect(row?.prepSeconds).toBe(600);
  });
});

describe("unquoted history", () => {
  it("excludes an unplanned line from the plan rate instead of scoring it on time", async () => {
    // Enough PLANNED lines to clear the identity floor the rate now carries —
    // this test is about the null-exclusion, not about suppression, so it has
    // to get past the floor to say anything at all.
    const planned = Array.from({ length: KITCHEN_CHEF_MIN_SAMPLE }, (_, index) =>
      line({ id: `p${index}`, ticket: { id: `tp${index}` } }),
    );
    const rows = await lineRows([
      ...planned,
      // Pre-FUT-364: no plan anchors at all. Must not read as "on time".
      line({ id: "l2", plannedFireAt: null, plannedReadyAt: null, ticket: { id: "t2" } }),
      line({ id: "l3", plannedFireAt: null, plannedReadyAt: null, ticket: { id: "t3" } }),
    ]);
    expect(rows.slice(-2).map((row) => row.plannedLines)).toEqual([null, null]);
    expect(rows.slice(-2).map((row) => row.planLateLines)).toEqual([null, null]);
    expect(rows.slice(-2).map((row) => row.unplannedLines)).toEqual([1, 1]);

    const result = await run(
      {
        entity: "kitchen_ticket_items",
        measures: [
          {
            field: "planLateLines",
            aggregation: "ratio",
            denominator: "plannedLines",
            alias: "taxa",
            format: "percent",
          },
          { field: "unplannedLines", aggregation: "sum", alias: "sem_plano" },
        ],
        presentation: { kind: "table" },
      },
      rows,
    );
    // Every PLANNED line was late. Treating the two NULL rows as 0 would report
    // 20/22 and invent an on-time record out of rows that carry no plan at all.
    expect(result.rows[0]?.taxa).toBe(1);
    expect(result.rows[0]?.sem_plano).toBe(2);
  });

  /**
   * `cozinha-plano-atraso` shows ONE count next to the plate-lateness p90 and
   * uses the same column as the rate's denominator. That double duty rests on
   * an invariant of this fact — a line reaches it only through its `readyAt`,
   * so a planned line always has a plate lateness — and the START lateness is
   * a strictly smaller population, because it also needs a registered start.
   * Both halves are pinned here rather than left as reasoning in a comment.
   */
  it("gives plate lateness the same population as `plannedLines`, and start lateness a smaller one", async () => {
    const rows = await lineRows([
      line({ id: "l1", ticket: { id: "t1" } }),
      // Planned and plated, but nobody registered the start: it has a plate
      // lateness and no fire lateness at all.
      line({ id: "l2", startedAt: null, startedById: null, ticket: { id: "t2" } }),
      // No plan whatsoever: out of both.
      line({ id: "l3", plannedFireAt: null, plannedReadyAt: null, ticket: { id: "t3" } }),
    ]);
    const plannedLines = rows.filter((row) => row.plannedLines === 1);
    const withPlateLateness = rows.filter((row) => row.planPlateLatenessSeconds !== null);
    expect(withPlateLateness).toHaveLength(plannedLines.length);
    expect(rows.filter((row) => row.planFireLatenessSeconds !== null)).toHaveLength(1);
  });

  it("excludes an unquoted pedido from the promise rate and counts it apart", async () => {
    const rows = await lineRows([
      line({ id: "l1", ticket: { id: "t1" } }),
      line({
        id: "l2",
        ticket: { id: "t2", dueAt: null, deliveredAt: new Date("2026-07-02T12:30:00.000Z") },
      }),
    ]);
    expect(rows.map((row) => row.ticketsPromised)).toEqual([1, null]);
    expect(rows.map((row) => row.ticketsPromiseBroken)).toEqual([1, null]);
    expect(rows.map((row) => row.ticketsUnquoted)).toEqual([0, 1]);
    expect(rows.map((row) => row.ticketPromiseLatenessSeconds)).toEqual([300, null]);
  });
});

describe("the two lateness signals", () => {
  it("keeps plan lateness and promise lateness in separate columns", async () => {
    // Late to its own plan by 120s, but delivered 300s past what the diner
    // was told: one number could not carry both.
    const [row] = await lineRows([BASE_LINE]);
    expect(row?.planPlateLatenessSeconds).toBe(120);
    expect(row?.ticketPromiseLatenessSeconds).toBe(300);
    expect(row?.planFireLatenessSeconds).toBe(0);
  });

  it("counts the diner promise once per pedido, not once per line", async () => {
    const rows = await lineRows([
      line({ id: "l1", ticket: { id: "t1" } }),
      line({ id: "l2", readyAt: new Date("2026-07-02T12:12:00.000Z"), ticket: { id: "t1" } }),
      line({ id: "l3", readyAt: new Date("2026-07-02T12:11:00.000Z"), ticket: { id: "t1" } }),
    ]);
    // The latest line of the pedido carries the promise; the rest carry null.
    expect(rows.map((row) => row.ticketsCompleted)).toEqual([null, 1, null]);
    const result = await run(
      {
        entity: "kitchen_ticket_items",
        measures: [
          { field: "ticketsCompleted", aggregation: "sum", alias: "pedidos" },
          { field: "lines", aggregation: "sum", alias: "linhas" },
        ],
        presentation: { kind: "table" },
      },
      rows,
    );
    expect(result.rows[0]).toEqual({ pedidos: 1, linhas: 3 });
  });
});

describe("handoffs and attribution", () => {
  it("keeps a handoff out of the cook's own column but visible as its own measure", async () => {
    const rows = await lineRows([
      line({ id: "l1", startedById: "cook-a", finishedById: "cook-b", ticket: { id: "t1" } }),
    ]);
    expect(rows[0]?.attribution).toBe("Repasse");
    expect(rows[0]?.chefName).toBeNull();
    expect(rows[0]?.chefId).toBeNull();
    expect(rows[0]?.handoffLines).toBe(1);
    expect(rows[0]?.attributedLines).toBe(1);
  });

  it("classifies a half-attributed line as unattributed, never as a handoff", async () => {
    const rows = await lineRows([line({ startedById: null, finishedById: "cook-b" })]);
    expect(rows[0]?.attribution).toBe("Sem atribuição");
    expect(rows[0]?.handoffLines).toBeNull();
    expect(rows[0]?.attributedLines).toBeNull();
    expect(rows[0]?.unattributedLines).toBe(1);
  });

  it("credits a solo line to its cook, falling back to the email", async () => {
    const rows = await lineRows([
      line({ id: "l1", startedById: "cook-b", finishedById: "cook-b" }),
    ]);
    expect(rows[0]?.attribution).toBe(KITCHEN_ATTRIBUTION_SOLO);
    expect(rows[0]?.chefName).toBe("bruno@x.com");
  });
});

describe("per-cook suppression", () => {
  const perChefSpec = (minSample?: number): ReportSpecInput => ({
    entity: "kitchen_ticket_items",
    dimensions: [{ field: "chefName" }],
    measures: [{ field: "lines", aggregation: "sum", alias: "linhas", minSample }],
    presentation: { kind: "table" },
  });

  it("refuses a per-cook spec that declares no floor", async () => {
    await expect(run(perChefSpec(), [])).rejects.toThrow(/minSample/);
  });

  it("refuses a per-cook spec whose floor is below the catalog's", async () => {
    await expect(run(perChefSpec(5), [])).rejects.toThrow(/at least 20/);
  });

  it("refuses a spec that narrows to one cook by FILTER instead of grouping", async () => {
    // The leak grouping alone would miss: no dimension at all, so the result is
    // ONE ungrouped row holding exactly one cook's numbers. This is also the
    // easiest per-cook spec to author over MCP.
    await expect(
      run(
        {
          entity: "kitchen_ticket_items",
          filters: [{ field: "chefId", operator: "eq", value: "cook-a" }],
          measures: [{ field: "prepSeconds", aggregation: "p90", alias: "preparo" }],
          presentation: { kind: "kpi" },
        },
        [],
      ),
    ).rejects.toThrow(/Filtering on "chefId"/);
  });

  it("allows the same narrowing once every measure carries the floor", async () => {
    const result = await run(
      {
        entity: "kitchen_ticket_items",
        filters: [{ field: "chefId", operator: "eq", value: "cook-a" }],
        measures: [
          {
            field: "prepSeconds",
            aggregation: "p90",
            alias: "preparo",
            minSample: KITCHEN_CHEF_MIN_SAMPLE,
          },
        ],
        presentation: { kind: "kpi" },
      },
      await lineRows([BASE_LINE]),
    );
    expect(result.rows[0]?.preparo).toBe(SUPPRESSED);
  });

  it("withholds the figure below the floor on every output path", async () => {
    const rows = await lineRows(
      Array.from({ length: 3 }, (_, index) =>
        line({ id: `l${index}`, ticket: { id: `t${index}` } }),
      ),
    );
    const result = await run(perChefSpec(KITCHEN_CHEF_MIN_SAMPLE), rows);
    // The row the HTTP API, the MCP tool and the CSV export all read from.
    expect(result.rows[0]?.linhas).toBe(SUPPRESSED);
    const render = result.render;
    expect(render.kind).toBe("table");
    if (render.kind === "table") {
      expect(render.rows[0]?.linhas).toBe(SUPPRESSED);
      // The export/table cell formatter is the one every surface renders with.
      expect(formatReportValue(render.rows[0]?.linhas, "integer")).toBe(SUPPRESSED_PLACEHOLDER);
    }
  });

  it("hands a suppressed KPI no figure at all", async () => {
    const rows = await lineRows([BASE_LINE]);
    const result = await run(
      {
        entity: "kitchen_ticket_items",
        measures: [
          {
            field: "prepSeconds",
            aggregation: "p90",
            alias: "preparo",
            minSample: KITCHEN_CHEF_MIN_SAMPLE,
          },
        ],
        presentation: { kind: "kpi" },
      },
      rows,
    );
    expect(result.render.kind).toBe("kpi");
    if (result.render.kind === "kpi") {
      expect(result.render.value).toBeNull();
      expect(result.render.suppressed).toBe(true);
    }
  });

  /**
   * The spec-shape check above reads the floor off the fields a spec NAMES,
   * and that is not a barrier: a spec need not name a cook to isolate one.
   * Every case here singles out a single cook's work WITHOUT any identity
   * field in the spec — the shapes an attacker actually has, given that
   * stations are enumerable over MCP (`listKitchenStations`) and shift→cook
   * over `listShifts`. Each must come back suppressed on the OUTPUT side,
   * because its own eligible sample is one.
   */
  describe("narrowings that never name a cook", () => {
    const soloLine = (overrides: LineOverrides = {}) =>
      line({ startedById: "cook-a", finishedById: "cook-a", ...overrides });

    async function kpi(spec: ReportSpecInput, lines: readonly FakeLine[]) {
      const result = await run(spec, await lineRows(lines));
      expect(result.render.kind).toBe("kpi");
      return result.render.kind === "kpi" ? result.render : null;
    }

    it("suppresses one station's Individual p90 — the reported reproduction", async () => {
      // `attribution eq "Individual"` HELPS the attacker: it strips the
      // handoffs, leaving only lines one person both started and finished.
      const render = await kpi(
        {
          entity: "kitchen_ticket_items",
          filters: [
            { field: "stationName", operator: "eq", value: "Grelha" },
            { field: "attribution", operator: "eq", value: KITCHEN_ATTRIBUTION_SOLO },
          ],
          measures: [{ field: "prepSeconds", aggregation: "p90", alias: "preparo" }],
          presentation: { kind: "kpi" },
        },
        [soloLine()],
      );
      expect(render?.value).toBeNull();
      expect(render?.suppressed).toBe(true);
      expect(JSON.stringify(render)).not.toContain("600");
    });

    it("suppresses a two-hour readyAt slice", async () => {
      const render = await kpi(
        {
          entity: "kitchen_ticket_items",
          filters: [
            {
              field: "readyAt",
              operator: "between",
              from: "2026-07-02T12:00:00.000Z",
              to: "2026-07-02T14:00:00.000Z",
            },
          ],
          measures: [{ field: "prepSeconds", aggregation: "p50", alias: "preparo" }],
          presentation: { kind: "kpi" },
        },
        [soloLine()],
      );
      expect(render?.suppressed).toBe(true);
    });

    it("suppresses a single demand hour, grouped by station", async () => {
      const result = await run(
        {
          entity: "kitchen_ticket_items",
          dimensions: [{ field: "stationName" }],
          filters: [{ field: "demandHourOfDay", operator: "eq", value: "08" }],
          measures: [
            { field: "planPlateLatenessSeconds", aggregation: "p90", alias: "atraso" },
            { field: "lines", aggregation: "sum", alias: "linhas" },
          ],
          presentation: { kind: "table" },
        },
        await lineRows([soloLine()]),
      );
      expect(result.rows[0]?.atraso).toBe(SUPPRESSED);
      // The VOLUME is not the private thing and stays readable — which is what
      // makes the suppressed cell beside it meaningful rather than a blank row.
      expect(result.rows[0]?.linhas).toBe(1);
    });

    it("suppresses one dish, and an `in` filter of exactly one station", async () => {
      const render = await kpi(
        {
          entity: "kitchen_ticket_items",
          filters: [
            { field: "productName", operator: "eq", value: "Picanha" },
            { field: "stationName", operator: "in", values: ["Grelha"] },
          ],
          measures: [
            { field: "ticketPromiseLatenessSeconds", aggregation: "p95", alias: "promessa" },
          ],
          presentation: { kind: "kpi" },
        },
        [soloLine()],
      );
      expect(render?.suppressed).toBe(true);
      expect(JSON.stringify(render)).not.toContain("300");
    });

    it("still answers once the sample clears the floor", async () => {
      // The floor is a sample rule, not a ban: the same question over enough
      // lines returns a figure, so the suppression above is not vacuous.
      const render = await kpi(
        {
          entity: "kitchen_ticket_items",
          filters: [{ field: "stationName", operator: "eq", value: "Grelha" }],
          measures: [{ field: "prepSeconds", aggregation: "p90", alias: "preparo" }],
          presentation: { kind: "kpi" },
        },
        Array.from({ length: KITCHEN_CHEF_MIN_SAMPLE }, (_, index) =>
          soloLine({ id: `s${index}`, ticket: { id: `ts${index}` } }),
        ),
      );
      expect(render?.suppressed).toBe(false);
      expect(render?.value).toBe(600);
    });
  });

  /**
   * A surrogate key is one row, and one row of kitchen work is one person's.
   * Neither kitchen entity may be grouped by its own id — the catalog does not
   * offer the field and the fact rows do not carry it.
   */
  describe("surrogate keys are not grouping keys", () => {
    it.each([
      ["kitchen_ticket_items", "prepSeconds"],
      ["kitchen_shifts", "laborHours"],
    ])("refuses to group %s by id", async (entity, field) => {
      await expect(
        run(
          {
            entity,
            dimensions: [{ field: "id" }],
            measures: [{ field, aggregation: "sum", alias: "valor" }],
            presentation: { kind: "table" },
          },
          [],
        ),
      ).rejects.toThrow(/Unknown field "id"/);
    });

    it("emits no id column on either fact", async () => {
      const [lineFact] = await lineRows([BASE_LINE]);
      expect(lineFact).not.toHaveProperty("id");
      const shiftFacts = (await fetchKitchenShifts(
        fakeDb([], [
          {
            id: "shift-1",
            startedAt: new Date("2026-07-02T10:00:00.000Z"),
            endedAt: new Date("2026-07-02T18:00:00.000Z"),
            endedReason: "user",
            resourceType: "kitchen",
            resourceId: "st-1",
          },
        ]),
        CLIENT_ID,
        WINDOW,
      )) as ReportRow[];
      expect(shiftFacts[0]).not.toHaveProperty("id");
    });
  });

  it("ships the per-cook preset over solo lines only, with the floor on every measure", () => {
    const preset = getSystemReport("cozinha-por-cozinheiro");
    const spec = preset?.build({ grain: "day" });
    expect(spec?.filters).toEqual([
      { field: "attribution", operator: "eq", value: KITCHEN_ATTRIBUTION_SOLO },
    ]);
    for (const measure of spec?.measures ?? []) {
      expect(measure.minSample).toBe(KITCHEN_CHEF_MIN_SAMPLE);
    }
  });
});

describe("kitchen shift facts", () => {
  const shift = (overrides: Partial<KitchenShiftSourceRow>): KitchenShiftSourceRow => ({
    id: "shift-1",
    startedAt: new Date("2026-07-02T10:00:00.000Z"),
    endedAt: new Date("2026-07-02T18:00:00.000Z"),
    endedReason: "user",
    resourceType: "kitchen",
    resourceId: "st-1",
    ...overrides,
  });

  async function shiftRows(
    shifts: readonly KitchenShiftSourceRow[],
    lines: readonly FakeLine[] = [],
  ): Promise<ReportRow[]> {
    const facts = await fetchKitchenShifts(fakeDb(lines, shifts), CLIENT_ID, WINDOW);
    return facts as ReportRow[];
  }

  it("keeps a closed shift that produced nothing in the labour denominator", async () => {
    const rows = await shiftRows([shift({ id: "empty" })]);
    expect(rows[0]?.zeroOutputShifts).toBe(1);
    expect(rows[0]?.laborHours).toBe(8);
    expect(rows[0]?.outputLines).toBe(0);
  });

  it("counts the lines a shift opened work on", async () => {
    const rows = await shiftRows([shift({})], [line({ shiftId: "shift-1", quantity: 3 })]);
    expect(rows[0]?.zeroOutputShifts).toBe(0);
    expect(rows[0]?.outputLines).toBe(1);
    expect(rows[0]?.outputQuantity).toBe(3);
  });

  /**
   * `linhas_por_hora` divides this count by the shift's hours, so it has to
   * count the SAME lines every other block of the canvas counts. Counting a
   * canceled plate or a waiter's fetch-only line credited the kitchen with
   * work it never did, against a denominator drawn from a different universe.
   */
  it("counts only the kitchen's own uncanceled lines toward a shift's output", async () => {
    const rows = await shiftRows(
      [shift({})],
      [
        line({ id: "ok", shiftId: "shift-1", quantity: 3, ticket: { id: "t1" } }),
        line({
          id: "canceled",
          shiftId: "shift-1",
          quantity: 5,
          canceledAt: new Date("2026-07-02T12:05:00.000Z"),
          ticket: { id: "t2" },
        }),
        line({ id: "garcom", shiftId: "shift-1", quantity: 7, route: "GARCOM", ticket: { id: "t3" } }),
      ],
    );
    expect(rows[0]?.outputLines).toBe(1);
    expect(rows[0]?.outputQuantity).toBe(3);
  });

  it("asks for the shifts that OVERLAP the window, not the ones that start in it", async () => {
    const db = fakeDb([], [shift({})]);
    await fetchKitchenShifts(db, CLIENT_ID, WINDOW);
    expect(db.shiftCalls[0]?.where).toEqual({
      clientId: CLIENT_ID,
      kind: "kitchen",
      // `startedAt` is still the anchor — it carries the window's exclusive
      // bound, which is what REPORT_ENTITY_DATE_FIELD names for this entity.
      startedAt: { lt: WINDOW.toExclusive },
      // …but an evening shift that BEGAN before the window is the shift whose
      // hours the window is trying to charge, so it must not be filtered out.
      OR: [{ endedAt: null }, { endedAt: { gt: WINDOW.from } }],
    });
  });

  it("clips a shift that runs past the window instead of counting it whole", async () => {
    const rows = await shiftRows([
      shift({
        startedAt: new Date("2026-06-30T22:00:00.000Z"),
        endedAt: new Date("2026-07-09T00:00:00.000Z"),
      }),
    ]);
    // The shift spans 8 days; only the 7-day window is charged. The fake
    // applies the fetcher's own predicate, so this row reaching the assertion
    // is itself the proof that a straddling shift is not dropped.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.laborHours).toBe(24 * 7);
  });

  it("keeps an evening shift that began before the window, with its output", async () => {
    // 22:00 the night before, closing at 02:00 inside the window: windowing on
    // `startedAt` dropped this shift entirely — its hours AND its lines — while
    // the same lines still counted in every other block of the same canvas.
    const rows = await shiftRows(
      [
        shift({
          startedAt: new Date("2026-06-30T22:00:00.000Z"),
          endedAt: new Date("2026-07-01T02:00:00.000Z"),
        }),
      ],
      [line({ shiftId: "shift-1", quantity: 2 })],
    );
    expect(rows).toHaveLength(1);
    // Four hours worked, only the two inside the window are charged.
    expect(rows[0]?.laborHours).toBe(2);
    expect(rows[0]?.outputLines).toBe(1);
  });

  it("still excludes a shift that had ended before the window opened", async () => {
    const rows = await shiftRows([
      shift({
        startedAt: new Date("2026-06-20T10:00:00.000Z"),
        endedAt: new Date("2026-06-20T18:00:00.000Z"),
      }),
    ]);
    expect(rows).toEqual([]);
  });

  it("keeps an open shift that began before the window", async () => {
    const rows = await shiftRows([
      shift({ startedAt: new Date("2026-06-30T20:00:00.000Z"), endedAt: null, endedReason: null }),
    ]);
    // Open, so it is clipped at BOTH edges: the whole 7-day window.
    expect(rows[0]?.laborHours).toBe(24 * 7);
  });

  it("labels an auto-closed shift rather than hiding its fabricated end", async () => {
    const rows = await shiftRows([shift({ endedReason: "auto" })]);
    expect(rows[0]?.autoClosed).toBe(true);
    expect(rows[0]?.autoClosedShifts).toBe(1);
    expect(rows[0]?.endedReason).toBe("Automático");
  });

  it("leaves an open shift out of the zero-output count", async () => {
    const rows = await shiftRows([shift({ endedAt: null, endedReason: null })]);
    expect(rows[0]?.closed).toBe(false);
    expect(rows[0]?.zeroOutputShifts).toBeNull();
    expect(rows[0]?.endedReason).toBe("Em aberto");
  });
});
