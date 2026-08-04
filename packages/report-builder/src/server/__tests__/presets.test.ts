import {
  compileReport,
  minSpanForPresentation,
  REPORT_GRID_COLUMNS,
  reportSpecSchema,
  type TimeGrain,
} from "../../index";
import { describe, expect, it } from "vitest";

import { KITCHEN_CHEF_MIN_SAMPLE } from "../adapter-kitchen-source";
import { REPORT_ENTITY_DATE_FIELD, reportCatalog } from "../catalog";
import {
  getSystemDashboard,
  getSystemReport,
  SYSTEM_DASHBOARDS,
  SYSTEM_REPORTS,
} from "../presets";

/**
 * Drift gate between the three Prisma-free reporting modules: every built-in
 * preset must stay compilable against the catalog (a renamed catalog field or
 * an invalid preset spec fails HERE, not at request time), and every catalog
 * entity must declare the date field the adapter windows on.
 */
describe("system report presets", () => {
  const grains: TimeGrain[] = ["day", "week", "month"];

  it.each(SYSTEM_REPORTS.map((report) => [report.key, report] as const))(
    "%s compiles against the catalog for every grain",
    (_key, report) => {
      for (const grain of grains) {
        const spec = reportSpecSchema.parse(report.build({ grain }));
        const query = compileReport(spec, reportCatalog);
        expect(query.entity).toBe(spec.entity);
        expect(query.measures.length).toBeGreaterThan(0);
      }
    },
  );

  it("has unique keys", () => {
    const keys = SYSTEM_REPORTS.map((report) => report.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only uses known permissions", () => {
    for (const report of SYSTEM_REPORTS) {
      expect(["reports:sales:read", "stock:read", "reports:kitchen:read"]).toContain(
        report.permission,
      );
    }
  });

  it("declares an adapter date field for every catalog entity", () => {
    for (const entity of Object.keys(reportCatalog.entities)) {
      expect(REPORT_ENTITY_DATE_FIELD[entity]).toBeDefined();
    }
  });

  it("announces the presentation its spec actually renders", () => {
    for (const report of SYSTEM_REPORTS) {
      const spec = reportSpecSchema.parse(report.build({ grain: "day" }));
      expect(spec.presentation.kind).toBe(report.presentation);
    }
  });
});

/**
 * WHICH measure each Cozinha preset publishes, pinned column by column.
 *
 * Nothing else in the suite pins this. The adapter proves that plan lateness
 * and promise lateness are computed apart, and the presets compile against the
 * catalog whichever of them they name — so swapping `planPlateLatenessSeconds`
 * for `ticketPromiseLatenessSeconds` in the plan report left every test green
 * while the page published the diner-promise number under the kitchen-plan
 * heading. The two signals disagree on exactly the shifts a manager would act
 * on (late to its own plan, on time to the table, or the reverse), so the swap
 * is invisible in aggregate and wrong in every individual case.
 *
 * Aliases are pinned too: they are the CSV's column names and the wire
 * contract a saved dashboard block reads by.
 */
type MeasurePin = readonly [alias: string, field: string, aggregation: string, denominator?: string];

const KITCHEN_MEASURE_PINS: Record<string, readonly MeasurePin[]> = {
  "cozinha-tempo-preparo": [
    ["linhas_com_espera", "waitSeconds", "count"],
    ["espera_p50", "waitSeconds", "p50"],
    ["espera_p90", "waitSeconds", "p90"],
    ["linhas_cronometradas", "prepSeconds", "count"],
    ["preparo_p50", "prepSeconds", "p50"],
    ["preparo_p90", "prepSeconds", "p90"],
  ],
  "cozinha-tendencia": [
    ["espera_p50", "waitSeconds", "p50"],
    ["preparo_p50", "prepSeconds", "p50"],
  ],
  "cozinha-por-prato": [
    ["linhas", "lines", "sum"],
    ["linhas_cronometradas", "prepSeconds", "count"],
    ["preparo_medio", "prepSeconds", "avg"],
    ["previsto_medio", "plannedPrepSeconds", "avg"],
    ["aderencia_ao_previsto", "prepSeconds", "ratio", "plannedPrepSeconds"],
  ],
  "cozinha-plano-atraso": [
    ["linhas_com_plano", "plannedLines", "sum"],
    ["linhas_sem_plano", "unplannedLines", "sum"],
    ["taxa_atraso_plano", "planLateLines", "ratio", "plannedLines"],
    ["atraso_prato_p90", "planPlateLatenessSeconds", "p90"],
    ["linhas_com_inicio", "planFireLatenessSeconds", "count"],
    ["atraso_inicio_p90", "planFireLatenessSeconds", "p90"],
  ],
  "cozinha-promessa-cliente": [
    ["pedidos", "ticketsCompleted", "sum"],
    ["pedidos_com_promessa", "ticketsPromised", "sum"],
    ["pedidos_sem_promessa", "ticketsUnquoted", "sum"],
    ["taxa_promessa_quebrada", "ticketsPromiseBroken", "ratio", "ticketsPromised"],
    ["atraso_promessa_p90", "ticketPromiseLatenessSeconds", "p90"],
  ],
  "cozinha-repasses": [
    ["linhas_com_autoria", "attributedLines", "sum"],
    ["repasses", "handoffLines", "sum"],
    ["taxa_repasse", "handoffLines", "ratio", "attributedLines"],
    ["linhas_sem_autoria", "unattributedLines", "sum"],
  ],
  "cozinha-por-cozinheiro": [
    ["linhas", "lines", "sum"],
    ["preparo_p50", "prepSeconds", "p50"],
    ["preparo_p90", "prepSeconds", "p90"],
    ["taxa_atraso_plano", "planLateLines", "ratio", "plannedLines"],
  ],
  "cozinha-demanda-por-horario": [["quantidade", "quantity", "sum"]],
  "cozinha-turnos": [
    ["turnos", "shifts", "sum"],
    ["horas", "laborSeconds", "sum"],
    ["fechados_pelo_sistema", "autoClosedShifts", "sum"],
    ["turnos_sem_producao", "zeroOutputShifts", "sum"],
    ["linhas_por_hora", "outputLines", "ratio", "laborHours"],
  ],
};

describe("Cozinha presets publish the measures they claim to", () => {
  it.each(Object.entries(KITCHEN_MEASURE_PINS))("%s", (key, expected) => {
    const pinned = getSystemReport(key);
    expect(pinned, `unknown preset ${key}`).toBeDefined();
    const spec = reportSpecSchema.parse(pinned?.build({ grain: "day" }));
    expect(
      spec.measures.map((measure) =>
        measure.denominator
          ? [measure.alias, measure.field, measure.aggregation, measure.denominator]
          : [measure.alias, measure.field, measure.aggregation],
      ),
    ).toEqual(expected.map((pin) => [...pin].filter((part) => part !== undefined)));
  });

  it("covers every kitchen preset", () => {
    const kitchenKeys = SYSTEM_REPORTS.filter((report) => report.section === "kitchen").map(
      (report) => report.key,
    );
    expect(new Set(Object.keys(KITCHEN_MEASURE_PINS))).toEqual(new Set(kitchenKeys));
  });

  /**
   * The families, stated once more as a rule rather than a list, so a NEW
   * measure added to either report is caught even if nobody updates the pins:
   * the kitchen-plan report may never publish a diner-promise figure, and the
   * diner-promise report may never publish a kitchen-plan one.
   */
  it.each([
    ["cozinha-plano-atraso", /^ticket/, /^plan/],
    ["cozinha-promessa-cliente", /^plan/, /^ticket/],
  ])("%s carries only its own lateness signal", (key, forbidden, required) => {
    const spec = reportSpecSchema.parse(getSystemReport(key)?.build({ grain: "day" }));
    const fields = spec.measures.flatMap((measure) =>
      measure.denominator ? [measure.field, measure.denominator] : [measure.field],
    );
    expect(fields.some((field) => required.test(field))).toBe(true);
    expect(fields.filter((field) => forbidden.test(field))).toEqual([]);
  });
});

/**
 * Built-in dashboards COMPOSE presets rather than restating their specs, which
 * puts the whole failure surface in the composition: a block naming a preset
 * that was renamed away, a span too narrow for what it renders, or a member
 * whose tier the canvas's own gate does not cover. Each is caught here.
 */
describe("system dashboards", () => {
  it("has unique keys", () => {
    const keys = SYSTEM_DASHBOARDS.map((dashboard) => dashboard.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only composes presets that exist, in its own section and tier", () => {
    for (const dashboard of SYSTEM_DASHBOARDS) {
      expect(dashboard.blocks.length).toBeGreaterThan(0);
      for (const block of dashboard.blocks) {
        const report = getSystemReport(block.reportKey);
        expect(report, `unknown preset ${block.reportKey}`).toBeDefined();
        expect(report?.section).toBe(dashboard.section);
        // A mixed-tier canvas would render partly empty for an actor holding
        // only some of the tiers, which reads as "no sales" rather than "no
        // permission" — so it is a definition error, not a runtime filter.
        expect(report?.permission).toBe(dashboard.permission);
      }
      const keys = dashboard.blocks.map((block) => block.reportKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("gives every block a readable width on the 12-column canvas", () => {
    for (const dashboard of SYSTEM_DASHBOARDS) {
      for (const block of dashboard.blocks) {
        const report = getSystemReport(block.reportKey);
        if (!report) continue;
        const spec = reportSpecSchema.parse(report.build({ grain: "day" }));
        expect(block.span).toBeGreaterThanOrEqual(minSpanForPresentation(spec.presentation));
        expect(block.span).toBeLessThanOrEqual(REPORT_GRID_COLUMNS);
      }
    }
  });

  it("merges every sales report of the Pedidos section", () => {
    // The point of the consolidation: no sales preset is left without a home on
    // the canvas, so dropping the individual menu rows hid nothing.
    const vendas = getSystemDashboard("vendas");
    expect(vendas).toBeDefined();
    expect(new Set(vendas?.blocks.map((block) => block.reportKey))).toEqual(
      new Set(
        SYSTEM_REPORTS.filter((report) => report.section === "orders").map((report) => report.key),
      ),
    );
  });

  it("merges every kitchen report of the Cozinha section", () => {
    const cozinha = getSystemDashboard("cozinha");
    expect(cozinha).toBeDefined();
    expect(new Set(cozinha?.blocks.map((block) => block.reportKey))).toEqual(
      new Set(
        SYSTEM_REPORTS.filter((report) => report.section === "kitchen").map((report) => report.key),
      ),
    );
  });

  /**
   * The two statements the ticket requires ON THE DASHBOARD, not only on the
   * deep-link page for one report: what is excluded from the data, and that a
   * thin sample is WITHHELD rather than absent. Asserted on the definition so
   * they cannot be dropped by a later edit to the canvas.
   */
  it("states the legacy-data exclusion and the sample policy on the Cozinha canvas", () => {
    const notes = (getSystemDashboard("cozinha")?.notes ?? []).join(" ");
    expect(notes).toMatch(/FUT-364/);
    expect(notes).toMatch(/fora das taxas/i);
    expect(notes).toContain(String(KITCHEN_CHEF_MIN_SAMPLE));
    expect(notes).toMatch(/linhas eleg/i);
  });

  it("covers the ticket's three questions with a block each", () => {
    const keys = getSystemDashboard("cozinha")?.blocks.map((block) => block.reportKey) ?? [];
    // Wait and cook, separately; per dish against the plan's estimate; and the
    // measures over time rather than one figure for the whole period.
    expect(keys).toContain("cozinha-tempo-preparo");
    expect(keys).toContain("cozinha-por-prato");
    expect(keys).toContain("cozinha-tendencia");
    const trend = reportSpecSchema.parse(getSystemReport("cozinha-tendencia")?.build({ grain: "week" }));
    expect(trend.dimensions).toEqual([{ field: "readyAt", timeGrain: "week" }]);
    expect(trend.presentation).toMatchObject({ kind: "chart", chartType: "line" });
    const dishes = reportSpecSchema.parse(getSystemReport("cozinha-por-prato")?.build({ grain: "day" }));
    expect(dishes.dimensions).toEqual([{ field: "productName" }]);
  });
});
