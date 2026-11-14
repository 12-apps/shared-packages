/**
 * FUT-4063, round-1 review: the CSV marks flagged rows and lists every name a
 * note holds, a text cell cannot start a formula, a cell reads its value label
 * or the host's bucket format, a built-in opens on a grain it offers, the empty
 * state never offers a period the surface does not, and a copy pack without
 * the notes' keys still reads.
 */
import { describe, expect, it } from "vitest";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { columnText } from "../lib/column-value";
import { csvTrailer, toCsv } from "../lib/export-rows";
import { initialGrain } from "../lib/report-chrome";
import { noteCsvLines, noteText } from "../lib/report-notes";
import { widenAction } from "../lib/widen-range";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import { exportColumnsFor } from "../report-render";
import type { ReportRender } from "../reports-api";

const VALUES = PT_BR_REPORT_ENGINE_COPY.values;

const BY_DAY: Extract<ReportRender, { kind: "table" }> = {
  kind: "table",
  columns: [
    { key: "day", label: "Dia", format: "text", bucketFormat: "weekday-day", grain: "day" },
    { key: "area", label: "Área", format: "text", valueLabels: { k: "Cozinha" } },
    { key: "ratio", label: "Custo / vendas", format: "percent", decimals: 0 },
  ],
  rows: [
    { day: "2026-11-09", area: "k", ratio: 0.25 },
    { day: "2026-11-10", area: "=HYPERLINK(1)", ratio: -0.12 },
  ],
  flag: { column: "ratio", label: "acima da meta", rows: [0] },
};

const weekdayDay = (value: string): string => `Seg ${value.slice(8, 10)}/${value.slice(5, 7)}`;

describe("a cell's text", () => {
  it("reads a declared value label, a host-formatted bucket, or the value at its precision", () => {
    expect(columnText("k", BY_DAY.columns[1]!, VALUES)).toBe("Cozinha");
    expect(columnText("2026-11-09", BY_DAY.columns[0]!, VALUES, weekdayDay)).toBe("Seg 09/11");
    expect(columnText("2026-11-09", BY_DAY.columns[0]!, VALUES)).toBe("2026-11-09");
    expect(columnText(0.25, BY_DAY.columns[2]!, VALUES)).toBe("25%");
  });
});

describe("the CSV", () => {
  const columns = exportColumnsFor(BY_DAY, VALUES, weekdayDay);
  const csv = toCsv(BY_DAY.rows, columns);

  it("adds the flag's words as a column, on the flagged rows only", () => {
    expect(csv.split("\n")).toEqual([
      "Dia,Área,Custo / vendas,acima da meta",
      "Seg 09/11,Cozinha,25%,acima da meta",
      "Seg 10/11,'=HYPERLINK(1),-12%,",
    ]);
  });

  it("guards TEXT cells against formulas and leaves a negative figure alone", () => {
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain(",-12%,");
    expect(csvTrailer(["+33 note"])).toBe("\n\n'+33 note");
  });

  it("has no flag column when no flag is declared", () => {
    const plain: ReportRender = { kind: "table", columns: BY_DAY.columns, rows: BY_DAY.rows };
    expect(exportColumnsFor(plain, VALUES).map((column) => column.header)).toEqual(["Dia", "Área", "Custo / vendas"]);
  });

  it("lists every name a note holds, where the screen caps them at three", () => {
    const note = { key: "n", text: "Sem custo/hora: {items}.", items: ["A", "B", "C", "D", "E"] };
    expect(noteText(note, PT_BR_REPORT_SCREENS_COPY.system)).toBe("Sem custo/hora: A; B; C e mais 2.");
    expect(noteCsvLines([note], PT_BR_REPORT_SCREENS_COPY.system)).toEqual(["Sem custo/hora: A; B; C; D; E."]);
  });
});

describe("a copy pack written before the notes' keys", () => {
  it("still reads, with language-neutral defaults", () => {
    const note = { key: "n", text: "{items}", items: ["A", "B", "C", "D"] };
    expect(noteText(note, {})).toBe("A; B; C +1");
  });
});

describe("grains and periods a built-in offers", () => {
  it("opens on day where offered, else on the first grain offered", () => {
    expect(initialGrain(undefined)).toBe("day");
    expect(initialGrain(["day", "week"])).toBe("day");
    expect(initialGrain(["week", "month"])).toBe("week");
  });

  it("never offers to widen to a period the surface does not offer", () => {
    const ranges = PT_BR_REPORT_SCREENS_COPY.ranges;
    expect(widenAction("7d", () => undefined, ranges)?.label).toBeDefined();
    expect(widenAction("7d", () => undefined, ranges, ["week", "7d", "month"])).toBeUndefined();
    expect(widenAction("7d", () => undefined, ranges, ["7d", "30d"])).toBeDefined();
  });
});
