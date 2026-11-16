// @vitest-environment jsdom
/**
 * FUT-4063, round-1 review: the single built-in page on a phone keeps a note
 * that asks to sit below the card (there is no card, so it sits below the
 * rendering), and its phone cards stack each line as a block of its own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from "../../server/pt-BR";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import type { ReportRender } from "../reports-api";
import { SystemDashboardPage } from "../system-dashboard";
import { SystemReportPage } from "../system-report";
import type { ReportBuilderTransport } from "../transport";
import { ReportBuilderProvider } from "../transport-context";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function asPhone(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

const RENDER: ReportRender = {
  kind: "table",
  columns: [
    { key: "day", label: "Dia", format: "text" },
    { key: "ratio", label: "Custo / vendas", format: "percent", decimals: 0 },
  ],
  rows: [{ day: "Seg 09/11", ratio: 0.34 }],
  flag: { column: "ratio", label: "acima da meta", rows: [0] },
  phone: { layout: "cards", figure: "ratio", subtitle: [{ measure: "day" }] },
};

function transport(): ReportBuilderTransport {
  return {
    get: async <T,>() =>
      ({
        key: "by-period",
        title: "Por dia",
        description: "",
        supportsGrain: false,
        range: { preset: "30d", from: "2026-11-01T03:00:00Z", toExclusive: "2026-11-15T03:00:00Z" },
        grain: "day",
        render: RENDER,
        notes: [
          { key: "auto", text: "1 turno fechado automaticamente ({items}).", items: ["sáb, Marcos"], phone: "below" },
        ],
      }) as T,
    getRaw: async <T,>() => ({}) as T,
    send: async () => ({ ok: true, data: undefined }) as never,
  };
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={client}>
        <ReportBuilderProvider
          transport={transport()}
          tenantSlug="acme"
          surface={{ systemReports: [], systemDashboards: [], sections: [], blockTemplates: [], timeZone: "UTC" }}
          copy={{ engine: PT_BR_REPORT_ENGINE_COPY, blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY, screens: PT_BR_REPORT_SCREENS_COPY }}
        >
          <MemoryRouter initialEntries={["/acme/reports/system/by-period"]}>
            <Routes>
              <Route path="/acme/reports/system/:reportKey" element={children} />
            </Routes>
          </MemoryRouter>
        </ReportBuilderProvider>
      </QueryClientProvider>
    );
  }
  render(<SystemReportPage tenantSlug="acme" />, { wrapper: Wrapper });
}

describe("the single built-in page on a phone", () => {
  it("draws the below-card note under the rendering, not nowhere", async () => {
    asPhone();
    renderPage();
    const below = await screen.findByTestId("report-render-below-notes");
    expect(below.textContent).toBe("1 turno fechado automaticamente (sáb, Marcos).");
  });

  it("keeps the note inside the rendering's notes above md, drawn once", async () => {
    renderPage();
    await screen.findByTestId("report-render-notes");
    expect(screen.queryAllByTestId("report-render-below-notes")).toHaveLength(0);
    expect(screen.getAllByText("1 turno fechado automaticamente (sáb, Marcos).")).toHaveLength(1);
  });

  it("stacks a card's name over its line, and its figure over its flag, as blocks", async () => {
    asPhone();
    renderPage();
    const card = await screen.findByTestId("report-render-card-0");
    const name = card.querySelector("[data-card-part=name]");
    const figure = card.querySelector("[data-card-part=figure]");
    // Each line its own block element: inline siblings would run "Seg 09/11"
    // into its subtitle and "34%" into "acima da meta" on one line.
    expect([...(name?.children ?? [])].map((line) => line.tagName)).toEqual(["DIV", "DIV"]);
    expect([...(figure?.children ?? [])].map((line) => line.tagName)).toEqual(["DIV", "DIV"]);
    expect(within(figure as HTMLElement).getByText("acima da meta")).toBeTruthy();
  });
});

describe("a bare dashboard block on a phone (frame: false)", () => {
  function renderDashboard(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }): JSX.Element {
      return (
        <QueryClientProvider client={client}>
          <ReportBuilderProvider
            transport={transport()}
            tenantSlug="acme"
            surface={{
              systemReports: [
                { key: "by-period", title: "Por dia", description: "", permission: "x", section: "team", supportsGrain: false },
              ],
              systemDashboards: [
                {
                  key: "team-cost",
                  title: "Custo de equipe",
                  description: "",
                  permission: "x",
                  section: "team",
                  blocks: [{ reportKey: "by-period", span: 12, frame: false }],
                },
              ],
              sections: [],
              blockTemplates: [],
              timeZone: "UTC",
            }}
            copy={{ engine: PT_BR_REPORT_ENGINE_COPY, blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY, screens: PT_BR_REPORT_SCREENS_COPY }}
          >
            <MemoryRouter initialEntries={["/acme/dashboards/team-cost"]}>
              <Routes>
                <Route path="/acme/dashboards/:dashboardKey" element={children} />
              </Routes>
            </MemoryRouter>
          </ReportBuilderProvider>
        </QueryClientProvider>
      );
    }
    render(<SystemDashboardPage tenantSlug="acme" />, { wrapper: Wrapper });
  }

  it("draws the below-card note under the bare block, not nowhere", async () => {
    asPhone();
    renderDashboard();
    const below = await screen.findByTestId("system-dashboard-block-by-period-below-notes");
    expect(below.textContent).toBe("1 turno fechado automaticamente (sáb, Marcos).");
    expect(screen.queryAllByTestId("system-dashboard-block-by-period-render-notes")).toHaveLength(0);
  });

  it("keeps the note inside the block above md, drawn once", async () => {
    renderDashboard();
    await screen.findByTestId("system-dashboard-block-by-period-render-notes");
    expect(screen.queryAllByTestId("system-dashboard-block-by-period-below-notes")).toHaveLength(0);
    expect(screen.getAllByText("1 turno fechado automaticamente (sáb, Marcos).")).toHaveLength(1);
  });
});
