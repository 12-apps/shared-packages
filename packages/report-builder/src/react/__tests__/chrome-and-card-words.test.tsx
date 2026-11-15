// @vitest-environment jsdom
/**
 * FUT-4063, round three on screen: a period label for ONE built-in, the
 * controls' options kept on one line (a select when they would wrap), the
 * chosen period and grain drawn neutral, and a phone card's plural words and
 * per-part joiners.
 */
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from "../../server/pt-BR";
import { ReportControls } from "../lib/report-chrome";
import { tableCard } from "../lib/table-cards";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import type { ReportRange, ReportTableColumn } from "../reports-api";
import { httpTransport } from "../transport";
import { ReportBuilderProvider, type ReportBuilderSurface, type ReportPeriodSurface } from "../transport-context";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function render(ui: ReactNode, surface: Partial<ReportBuilderSurface> = {}): void {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <MemoryRouter>
        <ReportBuilderProvider
          transport={httpTransport({ errors: PT_BR_REPORT_SCREENS_COPY.errors })}
          tenantSlug="acme"
          surface={{ systemReports: [], systemDashboards: [], sections: [], blockTemplates: [], timeZone: "UTC", ...surface }}
          copy={{ engine: PT_BR_REPORT_ENGINE_COPY, blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY, screens: PT_BR_REPORT_SCREENS_COPY }}
        >
          {children}
        </ReportBuilderProvider>
      </MemoryRouter>
    );
  }
  rtlRender(<>{ui}</>, { wrapper: Wrapper });
}

const controls = (surface: ReportPeriodSurface, range: ReportRange = "week") => (
  <ReportControls
    range={range}
    onRangeChange={() => undefined}
    grain="day"
    onGrainChange={() => undefined}
    showGrain
    grains={["day", "week"]}
    grainLabel="Agrupar por"
    ranges={["week", "7d", "month"]}
    surface={surface}
    printTitle="Custo"
  />
);

/** The host labels the team-cost dashboard's periods only. */
const periodLabel = (range: ReportRange, surface: ReportPeriodSurface): string | undefined =>
  surface.key === "team-cost" ? (range === "week" ? "Esta semana · 09–15/11" : `${range} · datas`) : undefined;

describe("a period label for one built-in", () => {
  it("turns that built-in's period into a select that reads the host's label", () => {
    render(controls({ kind: "dashboard", key: "team-cost" }), { periodLabel });
    expect(screen.getByTestId("report-range").textContent).toContain("Esta semana · 09–15/11");
    expect(screen.queryAllByRole("group", { name: PT_BR_REPORT_SCREENS_COPY.builder.period })).toHaveLength(0);
  });

  it("leaves every other built-in on its toggle", () => {
    render(controls({ kind: "report", key: "sales" }), { periodLabel });
    const group = screen.getByRole("group", { name: PT_BR_REPORT_SCREENS_COPY.builder.period });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Esta semana",
      "7 dias",
      "Este mês",
    ]);
  });

  it("completes a period the host did not label with the package's own words", () => {
    const partial = (range: ReportRange): string | undefined => (range === "week" ? "Esta semana · 09–15/11" : undefined);
    render(controls({ kind: "report", key: "x" }, "7d"), { periodLabel: partial });
    expect(screen.getByTestId("report-range").textContent).toContain("7 dias");
  });

  it("tells the host which surface asks", () => {
    const seen: ReportPeriodSurface[] = [];
    render(controls({ kind: "dashboard", key: "team-cost" }), {
      periodLabel: (range, surface) => {
        seen.push(surface);
        return range;
      },
    });
    expect(seen[0]).toEqual({ kind: "dashboard", key: "team-cost" });
  });
});

describe("the choice is neutral", () => {
  it("draws the chosen period and grain with the quiet selection, never the primary fill", () => {
    render(controls({ kind: "report", key: "sales" }));
    for (const name of [PT_BR_REPORT_SCREENS_COPY.builder.period, "Agrupar por"]) {
      expect(screen.getByRole("group", { name }).getAttribute("data-selection")).toBe("quiet");
    }
    expect(screen.getByTestId("report-grain-item-day").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("options of one question on one line", () => {
  /** A layout where the toggle needs `needed` px and its row offers `available`. */
  function layout(needed: number, available: number): void {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "group" ? needed : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-choice") ? available : 0;
    });
  }

  it("keeps the toggle while its labels fit the row", () => {
    layout(300, 358);
    render(controls({ kind: "report", key: "sales" }));
    expect(screen.getByTestId("report-range").closest("[data-choice]")?.getAttribute("data-choice")).toBe("toggle");
  });

  it("becomes a select when the labels would wrap, and keeps the question's name", () => {
    layout(420, 358);
    render(controls({ kind: "report", key: "sales" }));
    expect(screen.getByTestId("report-range").closest("[data-choice]")?.getAttribute("data-choice")).toBe("select");
    expect(screen.queryAllByRole("group", { name: PT_BR_REPORT_SCREENS_COPY.builder.period })).toHaveLength(0);
    expect(screen.getAllByText(PT_BR_REPORT_SCREENS_COPY.builder.period).length).toBeGreaterThan(0);
  });

  it("keeps the toggle with no layout at all", () => {
    render(controls({ kind: "report", key: "sales" }));
    expect(screen.getByTestId("report-grain").closest("[data-choice]")?.getAttribute("data-choice")).toBe("toggle");
  });
});

describe("a phone card's words", () => {
  const columns: ReportTableColumn[] = [
    { key: "area", label: "Área", format: "text" },
    { key: "hours", label: "Horas", format: "duration", decimals: 0 },
    { key: "people", label: "Pessoas", format: "integer" },
    { key: "cost", label: "Custo", format: "brl", decimals: 0 },
    { key: "sales", label: "Vendas", format: "brl", decimals: 0 },
  ];
  const phone = {
    layout: "cards" as const,
    subtitle: [
      { measure: "hours" },
      { measure: "cost" },
      { measure: "sales", joiner: " de " },
      { measure: "people", suffix: " pessoas", suffixOne: " pessoa" },
    ],
  };
  const card = (people: number) =>
    tableCard(
      { area: "Salão", hours: 62 * 3600, people, cost: 124_000, sales: 496_000 },
      columns,
      phone,
      PT_BR_REPORT_ENGINE_COPY.values,
    );

  it("joins each part with its own joiner, the default dot elsewhere", () => {
    expect(card(4).subtitle?.replace(/\u00a0/g, " ")).toBe("62 h · R$ 1.240 de R$ 4.960 · 4 pessoas");
  });

  it("reads one person in the singular, and none in the plural", () => {
    expect(card(1).subtitle?.endsWith("1 pessoa")).toBe(true);
    expect(card(0).subtitle?.endsWith("0 pessoas")).toBe(true);
  });

  it("keeps the plural for every value when no singular is given", () => {
    const plain = tableCard(
      { area: "Salão", people: 1 },
      columns,
      { layout: "cards", subtitle: [{ measure: "people", suffix: " pessoas" }] },
      PT_BR_REPORT_ENGINE_COPY.values,
    );
    expect(plain.subtitle).toBe("1 pessoas");
  });

  it("reads a part with no value in the host's words when it gives them", () => {
    const empty = tableCard(
      { area: "Entregas", share: null },
      [...columns, { key: "share", label: "% das vendas", format: "percent" }],
      { layout: "cards", figureCaption: { measure: "share", suffix: " das vendas", emptyText: "sem custo" } },
      PT_BR_REPORT_ENGINE_COPY.values,
    );
    expect(empty.figureCaption).toBe("sem custo");
  });
});
