// @vitest-environment jsdom
/**
 * FUT-4063, round two of review: the custom report's period (`RangeToggle`)
 * keeps its five options on ONE line — a select when they would wrap, whose
 * "Personalizado…" opens the picker and re-opens it when picked again — and a
 * resize that swaps the toggle for the select (or back) keeps the reader's
 * focus and brings the toggle back once the row is wide enough.
 */
import { act, cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { useState, type JSX, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from "../../server/pt-BR";
import { RangeToggle } from "../lib/range-toggle";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import type { ReportRange } from "../reports-api";
import { httpTransport } from "../transport";
import { ReportBuilderProvider } from "../transport-context";

/** The row's width the layout mock reports; a resize changes it and notifies. */
let available = 0;
const observers: Array<() => void> = [];

beforeEach(() => {
  available = 0;
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push(callback);
      }
      observe(): void {}
      disconnect(): void {
        const at = observers.indexOf(this.callback);
        if (at >= 0) observers.splice(at, 1);
      }
    },
  );
  // The five options need 520px; the wrapper's row offers `available`.
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "group" ? 520 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-choice") ? available : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function resizeTo(width: number): void {
  available = width;
  act(() => {
    for (const notify of [...observers]) notify();
  });
}

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MemoryRouter>
      <ReportBuilderProvider
        transport={httpTransport({ errors: PT_BR_REPORT_SCREENS_COPY.errors })}
        tenantSlug="acme"
        surface={{ systemReports: [], systemDashboards: [], sections: [], blockTemplates: [], timeZone: "UTC" }}
        copy={{ engine: PT_BR_REPORT_ENGINE_COPY, blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY, screens: PT_BR_REPORT_SCREENS_COPY }}
      >
        {children}
      </ReportBuilderProvider>
    </MemoryRouter>
  );
}

function Period({ initial }: { initial: ReportRange }): JSX.Element {
  const [range, setRange] = useState<ReportRange>(initial);
  return (
    <RangeToggle
      value={range}
      onChange={setRange}
      dataTestId="report-range"
      custom={{ seed: { from: "2026-01-05", to: "2026-01-09" }, onApply: () => setRange("custom") }}
    />
  );
}

function renderPeriod(width: number, initial: ReportRange = "30d"): void {
  available = width;
  rtlRender(<Period initial={initial} />, { wrapper: Wrapper });
}

const choice = (): string | null | undefined =>
  screen.getByTestId("report-range").closest("[data-choice]")?.getAttribute("data-choice");

function pickInSelect(id: ReportRange): void {
  fireEvent.mouseDown(within(screen.getByTestId("report-range")).getByRole("combobox"));
  fireEvent.click(screen.getByTestId(`report-range-option-${id}`));
}

describe("the custom report's period on one line", () => {
  it("is the framed toggle while its five options fit", () => {
    renderPeriod(600);
    expect(choice()).toBe("toggle");
    expect(screen.getByTestId("report-range-item-custom")).toBeTruthy();
  });

  it("is a select, named by the question, when the five options would wrap", () => {
    renderPeriod(358);
    expect(choice()).toBe("select");
    expect(screen.queryAllByRole("group", { name: PT_BR_REPORT_SCREENS_COPY.builder.period })).toHaveLength(0);
    expect(screen.getAllByText(PT_BR_REPORT_SCREENS_COPY.builder.period).length).toBeGreaterThan(0);
  });

  it("opens the picker when 'Personalizado…' is picked in the select", async () => {
    renderPeriod(358);
    pickInSelect("custom");
    expect(await screen.findByTestId("report-range-custom")).toBeTruthy();
  });

  it("re-opens the picker when 'Personalizado…' is picked again while it is the period", async () => {
    renderPeriod(358, "custom");
    pickInSelect("custom");
    expect(await screen.findByTestId("report-range-custom")).toBeTruthy();
  });

  it("does nothing when an active rolling preset is picked again", () => {
    renderPeriod(358, "30d");
    pickInSelect("30d");
    expect(screen.queryByTestId("report-range-custom")).toBeNull();
  });

  it("applies a rolling preset picked in the select", () => {
    renderPeriod(358, "30d");
    pickInSelect("7d");
    expect(within(screen.getByTestId("report-range")).getByRole("combobox").textContent).toBe("7 dias");
  });
});

describe("a resize that swaps the control", () => {
  it("brings the toggle back once the row is wide enough again", () => {
    renderPeriod(600);
    resizeTo(358);
    expect(choice()).toBe("select");
    resizeTo(1200);
    expect(choice()).toBe("toggle");
  });

  it("moves focus to the select when the focused toggle is swapped out", () => {
    renderPeriod(600);
    act(() => screen.getByTestId("report-range-item-7d").focus());
    resizeTo(358);
    expect(document.activeElement).toBe(within(screen.getByTestId("report-range")).getByRole("combobox"));
  });

  it("moves focus to the chosen option when the focused select becomes the toggle", () => {
    renderPeriod(358, "7d");
    act(() => within(screen.getByTestId("report-range")).getByRole("combobox").focus());
    resizeTo(1200);
    expect(document.activeElement).toBe(screen.getByTestId("report-range-item-7d"));
  });

  it("leaves focus where it is when the control did not hold it", () => {
    renderPeriod(600);
    resizeTo(358);
    expect(document.activeElement).toBe(document.body);
  });
});
