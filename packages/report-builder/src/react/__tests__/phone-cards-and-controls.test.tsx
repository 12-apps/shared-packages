// @vitest-environment jsdom
/**
 * FUT-4063, round two on screen: a table's phone cards, a KPI over its target,
 * a note below its card on the phone, the notes at the end of the CSV, and the
 * period select / grain name a built-in's controls take from the host.
 */
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTheme } from "@12-apps/ui/mui/styles";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from "../../server/pt-BR";
import { csvTrailer } from "../lib/export-rows";
import { initialRange, ReportControls } from "../lib/report-chrome";
import { blockNotes, noteCsvLines, notesBelowCard } from "../lib/report-notes";
import { cardsApply, tableCard } from "../lib/table-cards";
import { contrastRatio as getContrastRatio } from "../lib/report-surface";
import { flaggedFigureInk, flaggedRowInk, flaggedRowTint } from "../lib/row-flag";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import { NotesBelowCard } from "../report-notes";
import { ReportRenderView } from "../report-render";
import type { ReportNoteView, ReportRange, ReportRender } from "../reports-api";
import { httpTransport } from "../transport";
import { ReportBuilderProvider, type ReportBuilderSurface } from "../transport-context";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every media query matches — the screen is a phone. */
function asPhone(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  );
}

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

const BY_AREA: Extract<ReportRender, { kind: "table" }> = {
  kind: "table",
  columns: [
    { key: "area", label: "Área", format: "text" },
    { key: "hours", label: "Horas", format: "duration", decimals: 0 },
    { key: "people", label: "Pessoas", format: "integer" },
    { key: "cost", label: "Custo", format: "brl", decimals: 0 },
    { key: "share", label: "% das vendas", format: "percent", decimals: 1 },
  ],
  rows: [
    { area: "Cozinha", hours: 210 * 3600, people: 9, cost: 441_000, share: 0.115 },
    { area: "Entregas", hours: 70 * 3600, people: 4, cost: 155_000, share: 0.04 },
  ],
  flag: { column: "cost", label: "acima da meta", rows: [1] },
  phone: {
    layout: "cards",
    figure: "cost",
    figureCaption: { measure: "share", suffix: " das vendas" },
    subtitle: [{ measure: "hours" }, { measure: "people", suffix: " pessoas" }],
  },
};

describe("tableCard", () => {
  it("draws Por área's two-line row: name and its line, cost and its share", () => {
    expect(tableCard(BY_AREA.rows[0]!, BY_AREA.columns, BY_AREA.phone!, PT_BR_REPORT_ENGINE_COPY.values)).toEqual({
      title: "Cozinha",
      subtitle: "210 h · 9 pessoas",
      lines: [],
      figure: { key: "cost", text: "R$ 4.410" },
      figureCaption: "11,5% das vendas",
    });
  });

  it("lists every other column as label/value lines when no subtitle is declared", () => {
    const card = tableCard(BY_AREA.rows[0]!, BY_AREA.columns, { layout: "cards", figure: "cost" }, PT_BR_REPORT_ENGINE_COPY.values);
    expect(card.lines.map((line) => `${line.label}: ${line.value}`)).toEqual([
      "Horas: 210 h",
      "Pessoas: 9",
      "% das vendas: 11,5%",
    ]);
  });
});

describe("a table with phone cards", () => {
  it("is a list of cards on the phone, the flagged one with its icon and words", () => {
    asPhone();
    render(<ReportRenderView render={BY_AREA} dataTestId="r" />);
    expect(screen.queryAllByTestId("r-table")).toHaveLength(0);
    const cards = within(screen.getByTestId("r-cards")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("210 h · 9 pessoas");
    expect(cards[0]?.querySelectorAll("[data-report-row-flag]")).toHaveLength(0);
    const flag = cards[1]?.querySelector("[data-report-row-flag]");
    expect(flag?.textContent).toBe("acima da meta");
    expect(flag?.querySelector("svg")).not.toBeNull();
  });

  it("stays a table above md", () => {
    render(<ReportRenderView render={BY_AREA} dataTestId="r" />);
    expect(screen.getByTestId("r-table")).toBeTruthy();
    expect(screen.queryAllByTestId("r-cards")).toHaveLength(0);
  });
});

describe("a KPI over its target", () => {
  it("draws that figure amber with an icon and its words, the others plain", () => {
    const kpi: ReportRender = {
      kind: "kpi",
      label: "Vendas",
      value: 3_834_000,
      suppressed: false,
      format: "brl",
      figures: [
        { label: "Vendas", value: 3_834_000, suppressed: false, format: "brl", decimals: 0 },
        { label: "Custo / vendas", value: 0.34, suppressed: false, format: "percent", decimals: 0, flag: { label: "acima da meta" } },
      ],
      rows: [],
    };
    render(<ReportRenderView render={kpi} dataTestId="k" />);
    expect(screen.getByTestId("k-kpi").textContent).toContain("R$ 38.340");
    expect(screen.getByTestId("k-kpi").querySelectorAll("[data-report-figure-flag]")).toHaveLength(0);
    const flagged = screen.getByTestId("k-kpi-1").querySelector("[data-report-figure-flag]");
    expect(flagged?.textContent).toBe("34% acima da meta");
    expect(flagged?.querySelector("svg")).not.toBeNull();
  });
});

describe("notes on the phone, and in the CSV", () => {
  const notes: ReportNoteView[] = [
    { key: "auto", text: "1 turno fechado automaticamente ({items}).", items: ["sáb, Marcos"], phone: "below" },
    { key: "rate", text: "Sem custo/hora: {items}.", items: ["Pedro (Entregas), 12 h"] },
    { key: "hint", text: "meta 30%", figure: 3 },
  ];

  it("moves a 'below' note out of the card only on the phone", () => {
    expect(blockNotes(notes).map((note) => note.key)).toEqual(["auto", "rate"]);
    expect(blockNotes(notes, true).map((note) => note.key)).toEqual(["rate"]);
    expect(notesBelowCard(notes, true).map((note) => note.key)).toEqual(["auto"]);
    expect(notesBelowCard(notes, false)).toEqual([]);
  });

  it("draws the below note under the card on the phone, and nothing above md", () => {
    render(<NotesBelowCard notes={notes} tenantSlug="acme" dataTestId="b" />);
    expect(screen.queryAllByTestId("b-below-notes")).toHaveLength(0);
    cleanup();
    asPhone();
    render(<NotesBelowCard notes={notes} tenantSlug="acme" dataTestId="b" />);
    expect(screen.getByTestId("b-below-notes").textContent).toBe("1 turno fechado automaticamente (sáb, Marcos).");
  });

  it("ends the CSV with every shown note, one cell per line", () => {
    const lines = noteCsvLines(notes, PT_BR_REPORT_SCREENS_COPY.system);
    expect(lines).toEqual(["1 turno fechado automaticamente (sáb, Marcos).", "Sem custo/hora: Pedro (Entregas), 12 h.", "meta 30%"]);
    // A cell holding a comma is quoted, as every other CSV cell is.
    expect(csvTrailer(lines)).toBe(
      '\n\n"1 turno fechado automaticamente (sáb, Marcos)."\n"Sem custo/hora: Pedro (Entregas), 12 h."\nmeta 30%',
    );
    expect(csvTrailer([])).toBe("");
  });
});

describe("a built-in's controls", () => {
  const controls = (range: ReportRange = "week") => (
    <ReportControls
      range={range}
      onRangeChange={() => undefined}
      grain="day"
      onGrainChange={() => undefined}
      showGrain
      grains={["day", "week"]}
      grainLabel="Agrupar por"
      ranges={["week", "7d", "month"]}
      printTitle="Custo"
    />
  );

  it("names the grain toggle with the host's words and offers only its grains", () => {
    render(controls());
    const group = screen.getByRole("group", { name: "Agrupar por" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Dia", "Semana"]);
  });

  it("offers the built-in's periods, 'Esta semana' among them", () => {
    render(controls());
    const group = screen.getByRole("group", { name: PT_BR_REPORT_SCREENS_COPY.builder.period });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Esta semana",
      "7 dias",
      "Este mês",
    ]);
  });

  it("reads the current period whole when the host labels it", () => {
    render(controls(), { periodLabel: (range) => (range === "week" ? "Esta semana · 09–15/11" : String(range)) });
    expect(screen.getByTestId("report-range").textContent).toContain("Esta semana · 09–15/11");
  });

  it("opens on the first period the built-in offers, and on 30 dias when it offers no list", () => {
    expect(initialRange(undefined)).toBe("30d");
    expect(initialRange([])).toBe("30d");
    expect(initialRange(["week", "7d", "month", "30d"])).toBe("week");
    expect(initialRange(["7d", "week"])).toBe("7d");
  });
});

describe("when a table becomes cards", () => {
  const cards = (below?: "md" | "always" | number) => ({ layout: "cards" as const, ...(below !== undefined ? { below } : {}) });

  it("follows the viewport by default", () => {
    expect(cardsApply(cards(), true, 900)).toBe(true);
    expect(cardsApply(cards(), false, 280)).toBe(false);
  });

  it("follows the BLOCK's width when given one, so a narrow block on a wide screen reads as cards", () => {
    expect(cardsApply(cards(480), false, 281)).toBe(true);
    expect(cardsApply(cards(480), true, 600)).toBe(false);
    // Not measured yet: the viewport decides.
    expect(cardsApply(cards(480), false, 0)).toBe(false);
  });

  it("is always cards when asked, and never without a phone form", () => {
    expect(cardsApply(cards("always"), false, 2000)).toBe(true);
    expect(cardsApply(undefined, true, 100)).toBe(false);
  });
});

describe("the flag's ink reads at 4.5:1 on its tint in every palette and mode", () => {
  const themes = {
    "MUI light": createTheme({ palette: { mode: "light" } }),
    "MUI dark": createTheme({ palette: { mode: "dark" } }),
    "host light": createTheme({ palette: { mode: "light", warning: { main: "#8C5908" } } }),
    "host dark": createTheme({ palette: { mode: "dark", warning: { main: "#F5A623" } } }),
  };
  for (const [name, theme] of Object.entries(themes)) {
    it(name, () => {
      expect(getContrastRatio(flaggedRowInk(theme), flaggedRowTint(theme))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(flaggedFigureInk(theme), theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
