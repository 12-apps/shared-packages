import { compileReport, reportSpecSchema } from "../../index";
import { describe, expect, it } from "vitest";

import { createTenantReportDataSource, type ReportSourceDb } from "../adapter";
import { reportCatalog } from "../catalog";
import { lossLedgerWhere } from "../loss-predicate";

/**
 * The `perdas` entity reads the LEDGER, not the `loss_events` table (FUT-654).
 *
 * The defect this pins was measured through the MCP surface before it was
 * fixed: a loss registered as a standalone negative Ajuste moved the ledger by
 * 600 cents and moved the report by nothing, while the same loss registered
 * alongside a purchase moved the report by exactly its value. One user
 * intention, two write paths, one of them invisible to the report.
 *
 * Both directions of the error are asserted here, because a source that only
 * fixed the first would still overstate: cancelling a loss reverses the stock,
 * and the old source kept counting it — `loss_events` has no cancellation
 * column, so it structurally could not know.
 */

const CLIENT_ID = "client-1";
const WINDOW = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  toExclusive: new Date("2026-08-01T00:00:00.000Z"),
};

/** The taxonomy the fixture's movements are attributed to. */
const REASONS = [
  { id: "reason-spoiled", name: "estragou", kind: "LOSS" },
  { id: "reason-found", name: "Encontrei", kind: "GAIN" },
];

interface MovementFixture {
  id: string;
  createdAt: Date;
  type: string;
  quantityDelta: number;
  costCents: number | null;
  lossReasonId: string | null;
  item: { name: string };
}

/**
 * Every movement the tenant has, rebuilt per call so no test can observe
 * another's mutations. The stub applies the `where` the adapter passes, so the
 * predicate itself is what decides which rows survive — a stub that returned a
 * curated list would assert nothing about the predicate.
 */
function allMovements(): MovementFixture[] {
  return [
    // The case the bug hid: a standalone Ajuste, the common way to record a loss.
    {
      id: "adjust-loss",
      createdAt: new Date("2026-07-10T12:00:00.000Z"),
      type: "ADJUST",
      quantityDelta: -4,
      costCents: 600,
      lossReasonId: "reason-spoiled",
      item: { name: "Bacon em fatias" },
    },
    // The case that always worked: a loss captured alongside an entry.
    {
      id: "spoilage-loss",
      createdAt: new Date("2026-07-11T12:00:00.000Z"),
      type: "SPOILAGE",
      quantityDelta: -2,
      costCents: 300,
      lossReasonId: "reason-spoiled",
      item: { name: "Bacon em fatias" },
    },
    // A surplus. Attributed to the SAME taxonomy, so `lossReasonId != null` does
    // not make it a loss — only `kind` does.
    {
      id: "adjust-gain",
      createdAt: new Date("2026-07-12T12:00:00.000Z"),
      type: "ADJUST",
      quantityDelta: 3,
      costCents: 0,
      lossReasonId: "reason-found",
      item: { name: "Bacon em fatias" },
    },
    // Reconciliation: negative, but no reason attributed. Not a loss.
    {
      id: "adjust-reconciliation",
      createdAt: new Date("2026-07-13T12:00:00.000Z"),
      type: "ADJUST",
      quantityDelta: -7,
      costCents: 900,
      lossReasonId: null,
      item: { name: "Bacon em fatias" },
    },
    // A sale. Negative and costed, but never a loss.
    {
      id: "sale",
      createdAt: new Date("2026-07-14T12:00:00.000Z"),
      type: "SALE",
      quantityDelta: -1,
      costCents: 150,
      lossReasonId: null,
      item: { name: "Bacon em fatias" },
    },
  ];
}

/** Apply the adapter's `where` the way the database would. */
function applyWhere(
  movements: MovementFixture[],
  where: ReturnType<typeof lossLedgerWhere>,
): MovementFixture[] {
  return movements.filter((movement) => {
    if (movement.createdAt < where.createdAt.gte) return false;
    if (movement.createdAt >= where.createdAt.lt) return false;
    if (where.quantityDelta && !(movement.quantityDelta < where.quantityDelta.lt)) return false;
    if (where.lossReasonId && movement.lossReasonId === null) return false;
    return true;
  });
}

/**
 * A stub host client. `canceledAt: null` is honoured by construction — a
 * cancelled row simply is not in the tenant's live set, which is what the
 * cancellation test models by dropping one.
 */
function stubDb(movements: MovementFixture[] = allMovements()): ReportSourceDb {
  return {
    stockMovement: {
      findMany: async (args: { where: ReturnType<typeof lossLedgerWhere> }) =>
        applyWhere(movements, args.where),
    },
    lossReason: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        REASONS.filter((reason) => args.where.id.in.includes(reason.id)),
    },
  } as unknown as ReportSourceDb;
}

/**
 * Run the `loss_events` entity grouped by one dimension. The spec goes through
 * the real schema + compiler rather than a hand-built `CompiledQuery`, so the
 * catalog's own field definitions are exercised too.
 */
async function runLossQuery(
  db: ReportSourceDb,
  dimension = "reasonName",
  measure = "lossValueCents",
) {
  const source = createTenantReportDataSource(async () => db, CLIENT_ID, WINDOW);
  const spec = reportSpecSchema.parse({
    entity: "loss_events",
    dimensions: [{ field: dimension }],
    measures: [{ field: measure, aggregation: "sum", alias: "valor" }],
    presentation: { kind: "table" },
  });
  return source.execute(compileReport(spec, reportCatalog));
}

describe("the perdas entity reads the ledger", () => {
  it("counts a loss registered as a standalone negative Ajuste", async () => {
    const rows = await runLossQuery(stubDb());
    // 600 (the Ajuste the old source could not see) + 300 (the SPOILAGE it could).
    expect(rows).toEqual([{ reasonName: "estragou", valor: 900 }]);
  });

  it("excludes a surplus attributed to a GAIN reason", async () => {
    const rows = await runLossQuery(stubDb());
    // "Encontrei" carries a lossReasonId like any loss does; only `kind` tells
    // them apart, and it is not expressible in the `where`.
    expect(rows.some((row) => row.reasonName === "Encontrei")).toBe(false);
  });

  it("excludes negative rows with no reason attributed", async () => {
    const rows = await runLossQuery(stubDb());
    // Reconciliation (-7, 900 cents) and the sale (-1, 150) are both negative
    // and costed; neither is a loss. Their value never reaches the total.
    expect(rows).toEqual([{ reasonName: "estragou", valor: 900 }]);
  });

  it("stops counting a loss once its movement is cancelled", async () => {
    // The second direction of the bug: the old source kept a cancelled loss in
    // the report forever, because the table it read has no cancellation column.
    const live = allMovements().filter((movement) => movement.id !== "adjust-loss");
    const rows = await runLossQuery(stubDb(live));
    expect(rows).toEqual([{ reasonName: "estragou", valor: 300 }]);
  });

  it("reports the loss quantity as a positive magnitude", async () => {
    const rows = await runLossQuery(stubDb(), "itemName", "quantity");
    // The ledger signs a loss negative; "quantidade perdida" is 4 + 2, not -6.
    expect(rows).toEqual([{ itemName: "Bacon em fatias", valor: 6 }]);
  });
});

describe("the canonical loss predicate", () => {
  it("scopes to the tenant, the window, the sign and the attribution", () => {
    expect(lossLedgerWhere(CLIENT_ID, WINDOW)).toEqual({
      clientId: CLIENT_ID,
      canceledAt: null,
      createdAt: { gte: WINDOW.from, lt: WINDOW.toExclusive },
      quantityDelta: { lt: 0 },
      lossReasonId: { not: null },
    });
  });

  it("does not constrain `type`", () => {
    // Deliberate: losses land as ADJUST *or* SPOILAGE depending on which path
    // recorded them, and constraining the type is what split the two sources in
    // the first place. Reconciliation and opening stock are ADJUST too, and are
    // excluded by carrying no reason rather than by their type.
    expect(lossLedgerWhere(CLIENT_ID, WINDOW)).not.toHaveProperty("type");
  });
});
